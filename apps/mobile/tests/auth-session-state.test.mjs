import assert from "node:assert/strict";
import test from "node:test";
import {
  accessTokenChanged,
  isSessionFresh,
  mergeRefreshedSession,
  parseStoredSession,
  refreshDelayMs,
  SerializedSessionWriter,
  sessionForUnauthorizedResponse,
} from "../src/services/auth/session-state.ts";

const session = {
  version: 2,
  accessToken: "access-1",
  refreshToken: "refresh-1",
  issuedAt: 1_000,
  expiresIn: 300,
  user: { id: 7, email: "user@example.test" },
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

test("uses the newest session for a stale unauthorized response", () => {
  const rotated = {
    ...session,
    accessToken: "access-2",
    refreshToken: "refresh-2",
  };
  assert.equal(sessionForUnauthorizedResponse(session, rotated), rotated);
  assert.equal(sessionForUnauthorizedResponse(rotated, rotated), rotated);
});

test("schedules expiry refresh and a bounded transient retry", () => {
  assert.equal(refreshDelayMs(session, 1_100_000), 140_000);
  assert.equal(refreshDelayMs(session, 1_100_000, 1_105_000), 5_000);
  assert.equal(refreshDelayMs(session, 1_110_000, 1_105_000), 1_000);
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
