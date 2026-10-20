import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  assertAuthorizationResponseIssuer,
  assertStagingMobileRedirect,
  awaitCurrentAuthStep,
  authDataNamespace,
  assertSyncConfiguration,
  retryUnauthorizedRequest,
  oauthResourceParams,
  sameSessionBinding,
  sessionForAuthContext,
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


const productionBinding = {
  issuer: "https://auth.shocker.cl/realms/balance",
  clientId: "balance-mobile",
  apiBaseUrl: "https://balance.shocker.cl/api",
};
const stagingBinding = {
  issuer: "https://auth-staging.shocker.cl",
  clientId: "balance-mobile-staging",
  resource: "https://balance-staging.shocker.cl/api",
  apiBaseUrl: "https://balance-staging.shocker.cl/api",
};

test("binds unbound legacy sessions only to the exact previous production context", () => {
  const bound = sessionForAuthContext(session, productionBinding);
  assert.deepEqual(bound.binding, productionBinding);
  assert.equal(bound.refreshToken, session.refreshToken);
  assert.equal(sessionForAuthContext(session, stagingBinding), null);
  for (const changed of [
    { ...productionBinding, issuer: stagingBinding.issuer },
    { ...productionBinding, clientId: "other-client" },
    { ...productionBinding, resource: "https://balance.shocker.cl/api" },
    { ...productionBinding, apiBaseUrl: "https://other.example.invalid/api" },
  ]) assert.equal(sessionForAuthContext(session, changed), null);
  const legacy = resolveStoredSession(null, "legacy-token", false);
  assert.equal(sessionForAuthContext(legacy, stagingBinding), null);
  assert.deepEqual(sessionForAuthContext(legacy, productionBinding).binding, productionBinding);
});

test("checks every persisted binding field before reusing tokens or cached profile", () => {
  const bound = { ...session, binding: stagingBinding };
  assert.equal(sessionForAuthContext(bound, stagingBinding), bound);
  assert.equal(sessionForAuthContext(bound, productionBinding), null);
  for (const changed of [
    { ...stagingBinding, issuer: "https://other.example.invalid" },
    { ...stagingBinding, clientId: "other-client" },
    { ...stagingBinding, resource: undefined },
    { ...stagingBinding, resource: "https://balance-staging.shocker.cl/api/mcp" },
    { ...stagingBinding, apiBaseUrl: "https://balance.shocker.cl/api" },
  ]) {
    assert.equal(sameSessionBinding(stagingBinding, changed), false);
    assert.equal(sessionForAuthContext(bound, changed), null);
  }
});

test("malformed deciding binding cannot resurrect a legacy token", () => {
  for (const binding of [null, "wrong", { ...stagingBinding, issuer: 7 },
    { ...stagingBinding, resource: "" }, { ...stagingBinding, apiBaseUrl: undefined }]) {
    const record = JSON.stringify({ ...session, binding });
    assert.equal(parseStoredSession(record), null);
    assert.equal(resolveStoredSession(record, "legacy-token", false), null);
  }
});

test("refresh preserves identity context and web never gets renewable credentials", () => {
  const bound = { ...session, binding: stagingBinding };
  const rotated = mergeRefreshedSession(bound, {
    accessToken: "rotated", refreshToken: "rotated-refresh", issuedAt: 2_000,
  });
  assert.deepEqual(rotated.binding, stagingBinding);
  assert.deepEqual(parseStoredSession(JSON.stringify(rotated)), rotated);
  const web = mergeRefreshedSession(bound, { accessToken: "web", issuedAt: 2_000 }, true);
  assert.equal(web.refreshToken, undefined);
  assert.deepEqual(web.binding, stagingBinding);
  const hydrated = resolveStoredSession(JSON.stringify(bound), null, true);
  assert.equal(hydrated.refreshToken, undefined);
  assert.deepEqual(hydrated.binding, stagingBinding);
  assert.deepEqual(JSON.parse(sessionWritePlan(bound, true)[0].value).binding, stagingBinding);
});

test("same lineage never crosses issuer/client/resource/backend bindings", () => {
  const current = { ...session, binding: stagingBinding };
  const foreign = { ...current, binding: productionBinding, accessToken: "other" };
  assert.equal(sessionForUnauthorizedResponse(current, foreign), current);
  assert.equal(sessionForVerifiedProfile(current, foreign), current);
});

test("resource extras are explicit and absent for unchanged production defaults", () => {
  assert.deepEqual(oauthResourceParams(undefined), {});
  assert.deepEqual(oauthResourceParams(stagingBinding.resource), { resource: stagingBinding.resource });
});

test("advertised authorization response issuer rejects missing and mismatched callbacks", () => {
  assert.doesNotThrow(() => assertAuthorizationResponseIssuer(stagingBinding.issuer, stagingBinding.issuer, true));
  for (const actual of [undefined, "", productionBinding.issuer, `${stagingBinding.issuer}/`]) {
    assert.throws(() => assertAuthorizationResponseIssuer(stagingBinding.issuer, actual, true));
  }
  assert.doesNotThrow(() => assertAuthorizationResponseIssuer(productionBinding.issuer, undefined, false));
  assert.throws(() => assertAuthorizationResponseIssuer(stagingBinding.issuer, productionBinding.issuer, false));
});

test("staging accepts only its existing registered dev-client native redirect", () => {
  assert.doesNotThrow(() => assertStagingMobileRedirect(stagingBinding, "balance-dev", "balance-dev://auth-callback"));
  for (const [scheme, redirect] of [
    ["balance", "balance://auth-callback"], ["balance-daily", "balance-daily://auth-callback"],
    ["balance-dev", "balance-dev:///auth-callback"], ["balance-dev", "http://localhost/auth-callback"],
  ]) assert.throws(() => assertStagingMobileRedirect(stagingBinding, scheme, redirect));
  assert.throws(() => assertStagingMobileRedirect({ ...stagingBinding, clientId: "balance-mobile" }, "balance-dev", "balance-dev://auth-callback"));
  assert.doesNotThrow(() => assertStagingMobileRedirect(productionBinding, "balance", "balance://auth-callback"));
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("logout, manual-session, guest and newer login generations stop late login steps", async () => {
  for (const interruption of ["logout", "manual-session", "guest", "newer-login"]) {
    for (const blockedAt of ["discovery", "prompt", "exchange"]) {
      let epoch = 1;
      const current = () => epoch === 1;
      const pending = deferred();
      const calls = [];
      const finish = (async () => {
        for (const phase of ["discovery", "prompt", "exchange"]) {
          calls.push(phase);
          const result = await awaitCurrentAuthStep(phase === blockedAt ? pending.promise : Promise.resolve(phase), current);
          if (!result) return;
        }
        calls.push("adopt");
      })();
      // Allow prior completed phases to reach the selected in-flight step.
      while (!calls.includes(blockedAt)) await Promise.resolve();
      epoch += 1;
      pending.resolve(blockedAt);
      await finish;
      assert.equal(calls.includes("adopt"), false, `${interruption} at ${blockedAt}`);
      assert.equal(calls.at(-1), blockedAt);
    }
  }
});

test("latest login wins and a stale failure cannot alter current loading state", async () => {
  let epoch = 1;
  const late = deferred();
  const first = awaitCurrentAuthStep(late.promise, () => epoch === 1);
  epoch = 2;
  const second = await awaitCurrentAuthStep(Promise.resolve("latest"), () => epoch === 2);
  late.resolve("older");
  assert.equal(second, "latest");
  assert.equal(await first, undefined);
  await assert.doesNotReject(awaitCurrentAuthStep(Promise.reject(new Error("stale")), () => false));
  await assert.rejects(awaitCurrentAuthStep(Promise.reject(new Error("current")), () => true));
});


test("unauthorized retry cannot clear or retry a replacement login", async () => {
  let resolveRefresh;
  let epoch = 1;
  const captured = epoch;
  let cached = session;
  let requests = 0;
  let clears = 0;
  const original = { status: 401 };
  const pending = retryUnauthorizedRequest(original,
    () => new Promise(resolve => { resolveRefresh = resolve; }),
    () => epoch === captured,
    async () => { requests++; return { status: 200 }; },
    async () => { clears++; cached = null; });
  epoch++;
  cached = { ...session, accessToken: "new-login" };
  resolveRefresh({ ...session, accessToken: "late-refresh" });
  assert.equal(await pending, original);
  assert.equal(cached.accessToken, "new-login");
  assert.equal(requests, 0);
  assert.equal(clears, 0);
});

test("unauthorized transient refresh remains retryable and successful retry clears only current terminal 401", async () => {
  let clears = 0;
  let requests = 0;
  const original = { status: 401 };
  const request = async () => { requests++; return { status: 401 }; };
  const clear = async () => { clears++; };
  assert.equal(await retryUnauthorizedRequest(original, async () => null, () => true, request, clear), original);
  assert.equal(clears, 0);
  assert.equal(requests, 0);
  await retryUnauthorizedRequest(original, async () => session, () => true, request, clear);
  assert.equal(requests, 1);
  assert.equal(clears, 1);
});

test("data namespaces preserve production and isolate identical staging IDs", () => {
  assert.equal(authDataNamespace("https://balance.shocker.cl/api", 1), "user:1");
  const staging = authDataNamespace("https://balance-staging.shocker.cl/api", 1);
  assert.equal(staging, "user:https%3A%2F%2Fbalance-staging.shocker.cl%2Fapi:1");
  assert.notEqual(staging, "user:1");
});


test("actual sync collection and outbox storage cannot cross API namespaces", async () => {
  const values = new Map();
  const storage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  const nativeRequire = createRequire(import.meta.url);
  const load = url => {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(url, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const require = name => {
      if (name === "react-native") return { AppState: { addEventListener() {} } };
      if (name === "@/services/config") return { WS_SYNC_URL: "wss://example.test" };
      if (name === "@/services/storage") return { storage };
      if (name === "@/services/auth/session-state") return { accessTokenChanged };
      if (name.startsWith(".")) return load(new URL(`${name}.ts`, url));
      return nativeRequire(name);
    };
    runInNewContext(code, { module, exports: module.exports, require, console, setTimeout, clearTimeout,
      WebSocket: { CLOSED: 3, OPEN: 1 } });
    return module.exports;
  };
  const { SyncClient, collectionStorageKey } = load(new URL("../src/services/sync/sync-client.ts", import.meta.url));
  const { isSyncDocument } = load(new URL("../src/services/sync/types.ts", import.meta.url));
  const client = new SyncClient();
  const production = authDataNamespace("https://balance.shocker.cl/api", 1);
  const staging = authDataNamespace("https://balance-staging.shocker.cl/api", 1);
  const collection = "userPreferences";
  const doc = { id: "same-document", updatedAt: 1, _deleted: false, preferences: { weightTrackingEnabled: false } };
  assert.equal(isSyncDocument(collection, doc), true);
  for (const namespace of [production, staging]) {
    client.setNamespace(namespace);
    const saved = { ...doc, preferences: { weightTrackingEnabled: namespace === staging } };
    assert.equal(isSyncDocument(collection, saved), true);
    await storage.setItem(collectionStorageKey(namespace, collection), JSON.stringify([saved]));
    await client.enqueue(collection, saved);
  }
  for (const namespace of [production, staging, production]) {
    client.setNamespace(namespace);
    await client.loadOutbox();
    const entries = [...client.outbox.values()];
    assert.equal(entries.length, 1);
    assert.equal(entries[0].collection, collection);
    assert.equal(isSyncDocument(collection, entries[0].document), true);
    assert.equal(entries[0].document.preferences.weightTrackingEnabled, namespace === staging);
    const cached = JSON.parse(await storage.getItem(collectionStorageKey(namespace, collection)));
    assert.equal(cached.length, 1);
    assert.equal(isSyncDocument(collection, cached[0]), true);
    assert.equal(cached[0].preferences.weightTrackingEnabled, namespace === staging);
  }
  const outboxes = [...values.keys()].filter(key => key.startsWith("@balance_sync_outbox_v2:"));
  assert.deepEqual(outboxes, [`@balance_sync_outbox_v2:${production}`, `@balance_sync_outbox_v2:${staging}`]);
  assert.equal(JSON.parse(values.get(outboxes[0])).length, 1);
  assert.equal(JSON.parse(values.get(outboxes[1])).length, 1);
});

test("staging rejects production API and an explicitly different resource before discovery", () => {
  for (const binding of [
    { ...stagingBinding, apiBaseUrl: productionBinding.apiBaseUrl },
    { ...stagingBinding, resource: productionBinding.apiBaseUrl },
  ]) assert.throws(() => assertStagingMobileRedirect(binding, "balance-dev", "balance-dev://auth-callback"));
  assert.doesNotThrow(() => assertStagingMobileRedirect({ ...stagingBinding, resource: undefined }, "balance-dev", "balance-dev://auth-callback"));
});


test("logout during refresh or retry cannot clear a later generation", async () => {
  let current = true;
  let clears = 0;
  const original = { status: 401 };
  const refresh = deferred();
  let requests = 0;
  const pending = retryUnauthorizedRequest(original, () => refresh.promise, () => current,
    async () => { requests++; return original; }, async () => { clears++; });
  current = false;
  refresh.resolve(null);
  assert.equal(await pending, original);
  assert.equal(requests, 0);
  const retry = deferred();
  current = true;
  const retrying = retryUnauthorizedRequest(original, async () => session, () => current,
    () => retry.promise, async () => { clears++; });
  await Promise.resolve();
  current = false;
  retry.resolve(original);
  assert.equal(await retrying, original);
  assert.equal(clears, 0);
});


test("staging sync configuration is exact and default production remains legacy", () => {
  assert.doesNotThrow(() => assertSyncConfiguration(productionBinding.apiBaseUrl, "wss://balance.shocker.cl/api/ws/sync", "legacy", productionBinding.issuer, productionBinding.clientId));
  assert.doesNotThrow(() => assertSyncConfiguration(stagingBinding.apiBaseUrl, "wss://balance-staging.shocker.cl/api/ws/sync/application", "application", stagingBinding.issuer, stagingBinding.clientId));
  for (const [api,ws,mode] of [
    [productionBinding.apiBaseUrl,"wss://balance-staging.shocker.cl/api/ws/sync/application","application"],
    [stagingBinding.apiBaseUrl,"wss://balance.shocker.cl/api/ws/sync","application"],
    [stagingBinding.apiBaseUrl,"wss://balance-staging.shocker.cl/api/ws/sync/application","legacy"],
    [stagingBinding.apiBaseUrl,"wss://balance-staging.shocker.cl/api/ws/sync/application?token=x","application"],
  ]) assert.throws(() => assertSyncConfiguration(api,ws,mode,stagingBinding.issuer,stagingBinding.clientId));
});

test("actual application SyncClient waits for ACK and isolates socket generations and expired tokens", async () => {
  const values = new Map();
  const timers = new Map();
  let timerId = 0;
  const sockets = [];
  class FakeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
    readyState = 0;
    sent = [];
    constructor(url, protocols) { this.url = url; this.protocols = protocols; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  }
  const nativeRequire = createRequire(import.meta.url);
  const load = url => {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(url,"utf8"), { compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText;
    const require = name => {
      if (name === "react-native") return { AppState:{ addEventListener(){} } };
      if (name === "@/services/config") return { WS_SYNC_URL:"wss://balance-staging.shocker.cl/api/ws/sync/application", WS_AUTH_MODE:"application" };
      if (name === "@/services/storage") return { storage:{ getItem:async key => values.get(key) ?? null,setItem:async(key,value) => { values.set(key,value); },removeItem:async key => values.delete(key) } };
      if (name === "@/services/auth/session-state") return { accessTokenChanged };
      if (name.startsWith(".")) return load(new URL(`${name}.ts`,url));
      return nativeRequire(name);
    };
    runInNewContext(code,{ module,exports:module.exports,require,console,WebSocket:FakeSocket,
      setTimeout:(fn,delay) => { const id=++timerId; timers.set(id,{fn:() => { timers.delete(id); fn(); },delay}); return id; },clearTimeout:id => timers.delete(id) });
    return module.exports;
  };
  const { SyncClient } = load(new URL("../src/services/sync/sync-client.ts",import.meta.url));
  const client = new SyncClient();
  const ns = authDataNamespace(stagingBinding.apiBaseUrl,1);
  client.connect("token-first",ns);
  const first = sockets.at(-1);
  assert.deepEqual(Array.from(first.protocols),["balance"]);
  assert(!first.url.includes("token-first"));
  first.open();
  assert.deepEqual(first.sent,[{event:"authenticate",accessToken:"token-first"}]);
  await assert.rejects(client.pull("userPreferences"),/SYNC_OFFLINE/);
  await assert.rejects(client.push("userPreferences",[{newDocumentState:{id:1,preferences:{},updatedAt:1,_deleted:false}}]),/SYNC_OFFLINE/);
  await client.resync();
  const doc = { id:1,preferences:{weightTrackingEnabled:false},updatedAt:1,_deleted:false };
  await client.enqueue("userPreferences",doc);
  assert.equal(first.sent.length,1);
  first.message({event:"collection_changed",collection:"userPreferences"});
  assert.equal(first.sent.length,1);
  first.message({event:"authenticated"});
  await new Promise(resolve => setImmediate(resolve));
  assert(first.sent.some(frame => frame.event === "push"));
  client.disconnect();
  const length = first.sent.length;
  first.message({event:"authenticated"});
  first.open();
  assert.equal(first.sent.length,length);
  assert.equal(client.ready,false);
  assert.equal(client.pending.size,0);
  client.connect("token-second",ns);
  const second=sockets.at(-1);
  second.open();
  first.message({event:"authenticated"});
  assert.equal(client.ready,false);
  second.close(4001);
  const count=sockets.length;
  client.connect("token-second",ns);
  assert.equal(sockets.length,count);
  assert.equal(client.reconnectTimer,null);
  client.connect("token-third",ns);
  const third=sockets.at(-1);
  third.open();
  const timeout=[...timers.values()].find(timer => timer.delay === 12000);
  assert(timeout);
  timeout.fn();
  assert.equal(third.readyState,3);
  assert.equal(client.ready,false);
  assert(client.reconnectTimer);
  client.disconnect();
  assert.equal(timers.size,0);
  client.connect("token-fourth", "other-namespace");
  const fourth=sockets.at(-1);
  fourth.open();
  fourth.message({event:"authenticated"});
  client.connect("token-rotated", "other-namespace");
  const reconnect=timers.get(client.reconnectTimer);
  assert.equal(reconnect.delay,0);
  reconnect.fn();
  const rotated=sockets.at(-1);
  rotated.open();
  assert.equal(rotated.sent[0].accessToken,"token-rotated");
  fourth.message({event:"authenticated"});
  assert.equal(client.ready,false);
  rotated.onerror?.();
  rotated.close(1006);
  assert(client.reconnectTimer);
  client.disconnect();
});

test('claimed HTTPS redirect is exact and restricted to Android staging development', async () => {
  const { chosenMobileRedirect, STAGING_ANDROID_REDIRECT, allowsLegacyCallbackToken } = await import('../src/services/auth/session-state.ts');
  const binding = { issuer: 'https://auth-staging.shocker.cl', clientId: 'balance-mobile-staging', apiBaseUrl: 'https://balance-staging.shocker.cl/api', resource: 'https://balance-staging.shocker.cl/api' };
  const choose = (url, platform = 'android', variant = 'development', context = binding) => chosenMobileRedirect(context, 'balance-dev', platform, variant, url);
  assert.equal(choose(undefined), undefined);
  assert.equal(choose(STAGING_ANDROID_REDIRECT), STAGING_ANDROID_REDIRECT);
  assert.doesNotThrow(() => assertStagingMobileRedirect(binding, 'balance-dev', STAGING_ANDROID_REDIRECT, choose(STAGING_ANDROID_REDIRECT)));
  for (const url of ['https://evil.test/auth-callback', STAGING_ANDROID_REDIRECT + '/', STAGING_ANDROID_REDIRECT + '?x=1', 'balance-dev://auth-callback']) assert.throws(() => choose(url));
  for (const platform of ['ios', 'web']) assert.throws(() => choose(STAGING_ANDROID_REDIRECT, platform));
  for (const variant of ['daily', 'production', null]) assert.throws(() => choose(STAGING_ANDROID_REDIRECT, 'android', variant));
  assert.throws(() => choose(STAGING_ANDROID_REDIRECT, 'android', 'development', { ...binding, resource: undefined }));
  assert.throws(() => choose(STAGING_ANDROID_REDIRECT, 'android', 'development', { ...binding, issuer: 'https://auth.shocker.cl/realms/balance' }));
  assert.equal(allowsLegacyCallbackToken(binding.issuer, binding.clientId), false);
  assert.equal(allowsLegacyCallbackToken('https://auth.shocker.cl/realms/balance', 'balance-mobile'), true);
});

test('only development declares the exact verified Android callback', () => {
  const require = createRequire(import.meta.url);
  const config = require('../app.config.js');
  const previous = process.env.APP_VARIANT;
  try {
    for (const variant of ['development', 'daily', 'production']) {
      process.env.APP_VARIANT = variant;
      const filters = config().android.intentFilters;
      if (variant === 'development') assert.deepEqual(filters, [{ action: 'VIEW', autoVerify: true, category: ['BROWSABLE','DEFAULT'], data: [{ scheme: 'https', host: 'balance-staging.shocker.cl', path: '/auth-callback' }] }]);
      else assert.equal(filters, undefined);
    }
  } finally { if (previous === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = previous; }
});


test('logout hint is bounded, native-only, fails closed on malformed hydration, and stays with original refresh lineage', async () => {
  const { browserLogoutRequest }=await import('../src/services/auth/session-state.ts');
  const native={...session,idToken:'original-id',lineage:'original'};
  const record=sessionWritePlan(native,false)[0].value;
  assert.equal(resolveStoredSession(record,null,false).idToken,native.idToken);
  assert.equal(resolveStoredSession(record,null,true).idToken,undefined);
  assert.equal(JSON.parse(sessionWritePlan(native,true)[0].value).idToken,undefined);
  assert.equal(resolveStoredSession(null,'legacy-access',false).idToken,undefined);
  assert.equal(mergeRefreshedSession(native,{accessToken:'rotated',issuedAt:2000,idToken:'replacement'}).idToken,native.idToken);
  assert.equal(mergeRefreshedSession(native,{accessToken:'rotated',issuedAt:2000},true).idToken,undefined);
  for(const idToken of [null,42,{},'', ' ', ' padded','x'.repeat(2049)]) {
    const malformed=JSON.stringify({...native,idToken});
    assert.equal(parseStoredSession(malformed),null);
    assert.equal(resolveStoredSession(malformed,'older-legacy-token',false),null);
  }
  const binding={issuer:'https://auth-staging.shocker.cl',clientId:'balance-mobile-staging',apiBaseUrl:'https://balance-staging.shocker.cl/api'};
  const request=(endpoint='https://auth-staging.shocker.cl/logout',platform='android',hint='opaque.original')=>browserLogoutRequest(binding,endpoint,'balance-dev',platform,'balance-dev://logout-callback','a'.repeat(64),hint);
  assert.equal(new URL(request()).searchParams.get('id_token_hint'),'opaque.original');
  assert.equal(new URL(request(undefined,undefined,'x'.repeat(2048))).searchParams.get('id_token_hint').length,2048);
  for(const endpoint of ['https://evil.invalid/logout','https://auth-staging.shocker.cl/logout?x=1','https://auth-staging.shocker.cl/revoke']) assert.throws(()=>request(endpoint));
  assert.throws(()=>request(undefined,'web'));
  assert.throws(()=>request(undefined,undefined,''));
});


test('remembered metadata rejects malformed and foreign bindings and strips credentials/avatar', async () => {
  const {parseRememberedAccount,rememberedAccountForProfile}=await import('../src/services/auth/session-state.ts');
  const binding={issuer:'https://auth-staging.shocker.cl',clientId:'balance-mobile-staging',resource:'https://balance-staging.shocker.cl/api',apiBaseUrl:'https://balance-staging.shocker.cl/api'};
  const record=rememberedAccountForProfile({id:7,email:'synthetic@example.invalid',name:'Synthetic',picture:'https://invalid/avatar'},binding);
  for (const raw of [null,'{', '{}', JSON.stringify({...record,user:{id:'7',email:'e'}}),JSON.stringify({...record,user:{id:0,email:'e'}}), JSON.stringify({...record,user:{id:7,email:' '}}), JSON.stringify({...record,user:{id:7,email:'x'.repeat(321)}}), JSON.stringify({...record,user:{id:7,email:'e',name:'x'.repeat(201)}})]) assert.equal(parseRememberedAccount(raw,binding),null);
  for (const key of ['issuer','clientId','resource','apiBaseUrl']) assert.equal(parseRememberedAccount(JSON.stringify(record),{...binding,[key]:'different'}),null);
  const clean=parseRememberedAccount(JSON.stringify({...record,accessToken:'forbidden',user:{...record.user,picture:'remote',refreshToken:'forbidden'}}),binding);
  assert.deepEqual(clean,record);
});
