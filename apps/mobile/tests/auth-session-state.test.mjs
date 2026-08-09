import assert from "node:assert/strict";
import test from "node:test";
import {
  accessTokenChanged,
  isSessionFresh,
  LEGACY_TOKEN_KEY,
  LOGGED_OUT_MARKER,
  mergeRefreshedSession,
  nextSessionLineage,
  parseStoredSession,
  refreshDelayMs,
  refreshRetryDelayMs,
  resolveStoredSession,
  SerializedSessionWriter,
  SESSION_KEY,
  sessionForUnauthorizedResponse,
  sessionForVerifiedProfile,
  sessionWritePlan,
} from "../src/services/auth/session-state.ts";

const session = {
  version: 2,
  accessToken: "access-1",
  refreshToken: "refresh-1",
  issuedAt: 1_000,
  expiresIn: 300,
  user: { id: 7, email: "user@example.test" },
  lineage: "chain-1",
};

test("parses only the versioned session shape", () => {
  assert.deepEqual(parseStoredSession(JSON.stringify(session)), session);
  assert.equal(parseStoredSession("legacy-access-token"), null);
  assert.equal(parseStoredSession('{"version":2,"accessToken":""}'), null);
  assert.equal(
    parseStoredSession(
      '{"version":2,"accessToken":"token","issuedAt":1,"user":{"id":"wrong","email":"x"}}',
    ),
    null,
  );
  assert.equal(
    parseStoredSession(
      '{"version":2,"accessToken":"token","issuedAt":1,"lineage":7}',
    ),
    null,
  );
});

test("gives every credential chain its own lineage", () => {
  assert.notEqual(nextSessionLineage(), nextSessionLineage());
});

test("refreshes before the access token expiry boundary", () => {
  assert.equal(isSessionFresh(session, 1_200), true);
  assert.equal(isSessionFresh(session, 1_240), false);
});

test("keeps a rotating provider refresh token and the cached identity", () => {
  assert.deepEqual(
    mergeRefreshedSession(session, {
      accessToken: "access-2",
      refreshToken: "refresh-2",
      issuedAt: 1_200,
      expiresIn: 300,
    }),
    {
      ...session,
      accessToken: "access-2",
      refreshToken: "refresh-2",
      issuedAt: 1_200,
    },
  );
});

test("keeps the previous refresh token when the provider omits it", () => {
  assert.equal(
    mergeRefreshedSession(session, {
      accessToken: "access-2",
      issuedAt: 1_200,
      expiresIn: 300,
    }).refreshToken,
    "refresh-1",
  );
});

test("keeps the lineage across a refresh", () => {
  assert.equal(
    mergeRefreshedSession(session, {
      accessToken: "access-2",
      issuedAt: 1_200,
      expiresIn: 300,
    }).lineage,
    "chain-1",
  );
});

test("uses the newest session for a stale unauthorized response", () => {
  const rotated = {
    ...session,
    accessToken: "access-2",
    refreshToken: "refresh-2",
  };
  assert.equal(sessionForUnauthorizedResponse(session, rotated), rotated);
  assert.equal(sessionForUnauthorizedResponse(rotated, rotated), rotated);
});

test("never adopts a session from another credential chain", () => {
  // A deep link for a different account, installed while /me was in flight.
  const foreign = {
    ...session,
    accessToken: "access-other",
    refreshToken: undefined,
    user: undefined,
    lineage: "chain-2",
  };
  assert.equal(sessionForUnauthorizedResponse(session, foreign), session);
  assert.equal(sessionForVerifiedProfile(session, foreign), session);

  const rotated = { ...session, accessToken: "access-2" };
  assert.equal(sessionForVerifiedProfile(session, rotated), rotated);
  assert.equal(sessionForVerifiedProfile(session, null), session);

  // An unidentified session proves nothing, so it is never adopted either.
  const legacy = { ...session, accessToken: "access-3", lineage: undefined };
  assert.equal(sessionForVerifiedProfile(legacy, { ...legacy }), legacy);
});

test("schedules expiry refresh and a bounded transient retry", () => {
  assert.equal(refreshDelayMs(session, 1_100_000), 140_000);
  assert.equal(refreshDelayMs(session, 1_100_000, 1_105_000), 5_000);
  assert.equal(refreshDelayMs(session, 1_110_000, 1_105_000), 1_000);
});

test("backs off repeated transient refresh failures up to a cap", () => {
  assert.equal(refreshRetryDelayMs(1), 5_000);
  assert.equal(refreshRetryDelayMs(2), 10_000);
  assert.equal(refreshRetryDelayMs(4), 40_000);
  assert.equal(refreshRetryDelayMs(7), 300_000);
  assert.equal(refreshRetryDelayMs(99), 300_000);
});

test("writes the deciding record first and keeps it off the web", () => {
  const native = sessionWritePlan(session, false);
  assert.equal(native[0].key, SESSION_KEY);
  assert.deepEqual(JSON.parse(native[0].value), session);
  assert.deepEqual(native.slice(1), [{ key: LEGACY_TOKEN_KEY, value: null }]);

  // Page JavaScript can read browser storage, so the refresh token is dropped
  // by the write path too, not only when the session is read back.
  const web = sessionWritePlan(session, true);
  assert.equal(JSON.parse(web[0].value).refreshToken, undefined);
  assert.equal(web.length, 3);

  assert.equal(sessionWritePlan(null, false)[0].value, LOGGED_OUT_MARKER);
});

// Applies the first `steps` writes of a plan, as an interrupted logout or a
// crashed rotation would leave the device.
const applyPartially = (store, plan, steps) => {
  for (const { key, value } of plan.slice(0, steps)) {
    if (value === null) delete store[key];
    else store[key] = value;
  }
  return resolveStoredSession(
    store[SESSION_KEY] ?? null,
    store[LEGACY_TOKEN_KEY] ?? null,
    false,
  );
};

test("an interrupted logout can never resurrect the session", () => {
  const plan = sessionWritePlan(null, false);
  for (let steps = 1; steps <= plan.length; steps += 1) {
    const store = {
      [SESSION_KEY]: JSON.stringify(session),
      [LEGACY_TOKEN_KEY]: "legacy-access-token",
    };
    // The tombstone lands first, so every later failure is already harmless.
    assert.equal(applyPartially(store, plan, steps), null);
  }
});

test("an interrupted rotation never mixes two generations", () => {
  const rotated = {
    ...session,
    accessToken: "access-2",
    refreshToken: "refresh-2",
    issuedAt: 1_300,
  };
  const plan = sessionWritePlan(rotated, false);
  for (let steps = 0; steps <= plan.length; steps += 1) {
    const store = {
      [SESSION_KEY]: JSON.stringify(session),
      [LEGACY_TOKEN_KEY]: "legacy-access-token",
    };
    const resolved = applyPartially(store, plan, steps);
    // Either generation is acceptable; a mix of the two is not, because the
    // provider revokes the previous refresh token once rotation completes.
    const expected = steps === 0 ? session : rotated;
    assert.equal(resolved.accessToken, expected.accessToken);
    assert.equal(resolved.refreshToken, expected.refreshToken);
    assert.equal(resolved.issuedAt, expected.issuedAt);
  }
});

test("migrates a v1 token only when no v2 record decides otherwise", () => {
  const { lineage, ...migrated } = resolveStoredSession(
    null,
    "v1-token",
    false,
    4_000,
  );
  assert.deepEqual(migrated, {
    version: 2,
    accessToken: "v1-token",
    issuedAt: 4_000,
  });
  assert.equal(typeof lineage, "string");
  // A tombstone outranks a v1 token that a failed logout left behind.
  assert.equal(
    resolveStoredSession(LOGGED_OUT_MARKER, "v1-token", false),
    null,
  );
  assert.equal(
    resolveStoredSession(JSON.stringify(session), "v1-token", false)
      .accessToken,
    "access-1",
  );
  assert.equal(resolveStoredSession(null, null, false), null);
});

test("never returns a refresh token to the web platform", () => {
  assert.equal(
    resolveStoredSession(JSON.stringify(session), null, true).refreshToken,
    undefined,
  );
});

test("gives a migrated record a lineage so it is never adopted blindly", () => {
  const stored = { ...session, lineage: undefined };
  const resolved = resolveStoredSession(JSON.stringify(stored), null, false);
  assert.equal(typeof resolved.lineage, "string");
  // A second read is a different chain: nothing links the two in storage.
  const other = resolveStoredSession(JSON.stringify(stored), null, false);
  assert.equal(sessionForVerifiedProfile(resolved, other), resolved);
});

test("reconnects sync only when an established token changes", () => {
  assert.equal(accessTokenChanged("access-1", "access-2"), true);
  assert.equal(accessTokenChanged("access-1", "access-1"), false);
  assert.equal(accessTokenChanged(null, "access-1"), false);
});

test("a logout generation wins over an in-flight session write", async () => {
  let epoch = 1;
  let releaseFirstWrite;
  let markFirstWriteStarted;
  const firstWrite = new Promise((resolve) => {
    releaseFirstWrite = resolve;
  });
  const firstWriteStarted = new Promise((resolve) => {
    markFirstWriteStarted = resolve;
  });
  const writes = [];
  const commits = [];
  let writeCount = 0;
  const writer = new SerializedSessionWriter(
    async (value) => {
      writes.push(value);
      writeCount += 1;
      if (writeCount === 1) {
        markFirstWriteStarted();
        await firstWrite;
      }
    },
    () => epoch,
    (value) => commits.push(value),
  );

  const staleCommit = writer.commit(session, 1);
  await firstWriteStarted;
  epoch = 2;
  const logoutCommit = writer.commit(null, 2);
  releaseFirstWrite();

  assert.equal(await staleCommit, false);
  assert.equal(await logoutCommit, true);
  assert.deepEqual(writes, [session, null]);
  assert.deepEqual(commits, [null]);
});
