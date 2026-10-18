import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import * as sessionState from '../src/services/auth/session-state.ts';

// Execute the actual provider with controlled browser/network/storage adapters.
// No native runtime, provider credentials or live backend enters these tests.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const stage = {
  issuer: 'https://auth-staging.shocker.cl', clientId: 'balance-mobile-staging',
  resource: 'https://balance-staging.shocker.cl/api', apiBaseUrl: 'https://balance-staging.shocker.cl/api',
};
const legacy = {
  issuer: 'https://auth.shocker.cl/realms/balance', clientId: 'balance-mobile',
  apiBaseUrl: 'https://balance.shocker.cl/api',
};

async function harness(options = {}) {
  const binding = options.production ? legacy : stage;
  const values = new Map();
  if (options.session !== false) values.set(sessionState.SESSION_KEY, JSON.stringify({
    version: 2, accessToken: 'public-synthetic-access',
    refreshToken: options.refresh === false ? undefined : 'public-synthetic-refresh',
    issuedAt: Math.floor(Date.now() / 1000), expiresIn: options.initialExpiresIn,
    lineage: 'synthetic-family', binding,
  }));
  const calls = { discovery: [], refresh: [], revoke: [], browser: [], prompt: [], crypto: 0, sync: [], warnings: [], requests: [] };
  const timers = new Set();
  const scheduled = [];
  let appStateListener = () => {};
  const browser = deferred();
  const prompt = deferred();
  const discovery = { revocationEndpoint: `${binding.issuer}/revoke`,
    discoveryDocument: { authorization_response_iss_parameter_supported: true } };
  const TokenError = class extends Error {};
  const authSession = {
    ResponseType: { Code: 'code' }, TokenTypeHint: { RefreshToken: 'refresh_token' }, TokenError,
    makeRedirectUri: ({ scheme, path }) => `${scheme}://${path}`,
    fetchDiscoveryAsync: async issuer => {
      const index = calls.discovery.length;
      calls.discovery.push(issuer);
      return options.discovery?.(index) ?? discovery;
    },
    revokeAsync: async request => { calls.revoke.push(request); if (options.revoke) await options.revoke.promise; },
    exchangeCodeAsync: async () => ({ accessToken: 'public-next-access', refreshToken: 'public-next-refresh', issuedAt: Date.now()/1000 }),
    refreshAsync: async request => { calls.refresh.push(request.refreshToken); if (options.refreshAsync) return options.refreshAsync(request.refreshToken, calls.refresh.length); throw new Error('unexpected refresh'); },
    AuthRequest: class {
      codeVerifier = 'public-synthetic-code-verifier';
      constructor(request) { this.request = request; }
      promptAsync() { calls.prompt.push(this.request); return prompt.promise; }
    },
  };
  const secure = {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (value === sessionState.LOGGED_OUT_MARKER && options.storage) await options.storage.promise;
      values.set(key, value);
    },
    deleteItemAsync: async key => { values.delete(key); },
  };
  const config = {
    API_BASE_URL: binding.apiBaseUrl, OIDC_ISSUER: binding.issuer,
    OIDC_MOBILE_CLIENT_ID: binding.clientId, OIDC_RESOURCE: binding.resource,
    OIDC_SCOPES: ['openid','profile','email','offline_access'],
    OIDC_BROWSER_LOGOUT_URL: options.production ? undefined : options.endpoint ?? 'https://auth-staging.shocker.cl/logout',
  };
  const nativeRequire = createRequire(import.meta.url);
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/hooks/use-auth.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  let auth, renderer;
  // Preserve the real serialized writer, but place the diagnostic exactly
  // between a successful profile commit and verifySession's continuation.
  const authState = options.afterProfileCommit ? {
    ...sessionState,
    SerializedSessionWriter: class extends sessionState.SerializedSessionWriter {
      async commit(session, epoch) {
        const committed = await super.commit(session, epoch);
        if (committed && session?.user?.email === 'secret-next@example.invalid')
          options.afterProfileCommit(() => auth.runRefreshReplay());
        return committed;
      }
    },
  } : sessionState;
  const require = name => {
    if (name === 'react') return nativeRequire('react');
    if (name === 'expo-auth-session') return authSession;
    if (name === 'expo-web-browser') return { maybeCompleteAuthSession() {},
      openAuthSessionAsync: (url, redirect, browserOptions) => { calls.browser.push({ url, redirect, options: browserOptions }); return browser.promise; } };
    if (name === 'expo-crypto') return { getRandomBytesAsync: async count => {
      calls.crypto++;
      if (options.crypto) throw new Error('synthetic crypto unavailable');
      assert.equal(count, 32);
      return new Uint8Array(count).fill(calls.crypto);
    } };
    if (name === 'expo-secure-store') return secure;
    if (name === 'react-native') return { Platform: { OS: options.platform ?? 'android' }, AppState: { addEventListener: (_event, listener) => { appStateListener = listener; return { remove() {} }; } } };
    if (name === 'expo-constants') return { expoConfig: { scheme: options.scheme ?? (options.production ? 'balance' : 'balance-dev'), extra: { appVariant: options.variant ?? (options.production ? 'production' : 'development') } } };
    if (name === '@/services/config') return config;
    if (name === '@/services/auth/session-state') return authState;
    if (name === '@/services/storage') return { storage: {
      getItem: async key => values.get(key) ?? null,
      setItem: async (key, value) => { values.set(key,value); }, removeItem: async key => { values.delete(key); },
    } };
    if (name === '@/services/sync/sync-client') return { syncClient: {
      disconnect: () => calls.sync.push('disconnect'), setNamespace: namespace => calls.sync.push(namespace), connect: () => calls.sync.push('connect'),
    } };
    if (name === '@/services/sync/official-templates') return { fetchOfficialTemplates: async () => {} };
    throw new Error(`Unexpected module ${name}`);
  };
  runInNewContext(code, { module, exports: module.exports, require, URL, Uint8Array, Headers,
    __DEV__: options.dev ?? true, process: { env: { EXPO_PUBLIC_AUTH_DIAGNOSTICS: options.diagFlag ?? '1' } },
    console: { warn: (...values) => calls.warnings.push(values) },
    fetch: async (...args) => { calls.requests.push(args[0]); return options.fetch ? options.fetch(...args) : { ok: true, status: 200, json: async () => ({ data: { id: 7, email: 'synthetic@example.invalid' } }) }; },
    setTimeout: (callback, delay) => { if (delay === 30000 && options.deadline) { options.deadline.callback = callback; return 0; } scheduled.push({callback,delay}); const timer = setTimeout(callback, delay); timers.add(timer); return timer; },
    clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); },
  });
  function Probe() { auth = module.exports.useAuth(); return null; }
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(module.exports.AuthProvider, null, React.createElement(Probe)));
    await flush();
  });
  const start = async operation => {
    let pending;
    await act(async () => { pending = operation(auth); await flush(); });
    return { pending };
  };
  const finish = async (pending, result) => {
    browser.resolve(result);
    let value;
    await act(async () => { value = await pending; await flush(); });
    return value;
  };
  return { get auth() { return auth; }, calls, values, browser, prompt, start, finish, TokenError, scheduled,
    appState: state => appStateListener(state),
    validReturn: () => { const request=calls.browser.at(-1); return { type:'success',url:`${request.redirect}?state=${new URL(request.url).searchParams.get('state')}` }; },
    close: async () => { prompt.resolve({ type:'cancel' }); browser.resolve({ type:'cancel' });
      options.revoke?.resolve(); options.storage?.resolve(); await act(async () => { renderer.unmount(); await flush(); });
      for (const timer of timers) clearTimeout(timer); },
  };
}

test('real hook clears immediately, opens SSO logout without refresh and blocks overlapping login/double logout', async () => {
  const h = await harness({ refresh:false });
  try {
    assert(h.auth.user);
    const { pending } = await h.start(auth => auth.logout());
    assert.equal(h.auth.user,null);
    assert.equal(h.auth.isLoading,true);
    assert(h.calls.sync.includes('disconnect'));
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    assert.equal(h.calls.browser.length,1);
    assert.equal(h.calls.discovery.length,0);
    assert.equal(h.calls.browser[0].redirect,'balance-dev://logout-callback');
    assert.equal(h.calls.browser[0].options.preferEphemeralSession,false);
    assert.equal(new URL(h.calls.browser[0].url).searchParams.get('id_token_hint'),null);
    assert.equal(await h.auth.logout(),'in_progress');
    await h.auth.loginWithGoogle();
    assert.equal(h.calls.prompt.length,0);
    assert.equal(await h.finish(pending,h.validReturn()),'confirmed');
    assert.equal(h.auth.isLoading,false);
    const login = await h.start(auth => auth.loginWithGoogle());
    assert.equal(h.calls.prompt.length,1);
    h.prompt.resolve({type:'cancel'});
    await act(async () => { await login.pending; });
  } finally { await h.close(); }
});

test('real hook logout invalidates pending login and never queues browser logout behind it', async () => {
  const discovery = deferred();
  const h = await harness({ discovery:index => index===0 ? discovery.promise : undefined });
  try {
    const login = await h.start(auth => auth.loginWithGoogle());
    const logout = await h.start(auth => auth.logout());
    assert.equal(await logout.pending,'unconfirmed');
    assert.equal(h.auth.user,null);
    assert.equal(h.calls.revoke[0].token,'public-synthetic-refresh');
    await h.auth.loginWithGoogle();
    assert.equal(h.calls.discovery.length,2);
    discovery.resolve({ revocationEndpoint:'https://auth-staging.shocker.cl/revoke' });
    await act(async () => { await login.pending; await flush(); });
    assert.equal(h.calls.prompt.length,0);
    assert.equal(h.calls.browser.length,0);
    assert.equal(h.auth.isLoading,false);
  } finally { discovery.resolve({}); await h.close(); }
});

test('real hook stale logout during storage never opens the browser or clears a manual replacement', async () => {
  const storage = deferred();
  const h = await harness({storage});
  try {
    const logout = await h.start(auth => auth.logout());
    await act(async () => { h.auth.setAuthToken('public-manual-next'); await flush(); });
    assert.equal(h.calls.browser.length,0);
    storage.resolve();
    await act(async () => { assert.equal(await logout.pending,'unconfirmed'); await flush(); });
    assert.equal(JSON.parse(h.values.get(sessionState.SESSION_KEY)).accessToken,'public-manual-next');
    assert.equal(h.calls.browser.length,0);
  } finally { await h.close(); }
});

test('real hook revocation is independent and stale browser completion never adopts or clears a new session', async () => {
  const revoke = deferred();
  const h = await harness({revoke});
  try {
    const logout = await h.start(auth => auth.logout());
    assert.equal(h.calls.revoke.length,1);
    assert.equal(h.calls.browser.length,1,'pending revoke cannot block the browser');
    await act(async () => { h.auth.setAuthToken('public-manual-next'); await flush(); });
    await h.auth.loginWithGoogle();
    assert.equal(h.calls.prompt.length,0,'remote logout still owns the browser');
    assert.equal(await h.finish(logout.pending,h.validReturn()),'unconfirmed');
    assert.equal(JSON.parse(h.values.get(sessionState.SESSION_KEY)).accessToken,'public-manual-next');
    revoke.resolve();
    await act(async () => { await flush(); });
    assert.equal(JSON.parse(h.values.get(sessionState.SESSION_KEY)).accessToken,'public-manual-next');
  } finally { await h.close(); }
});

test('real hook validates exact unique state and callback without credential adoption', async () => {
  for (const variant of ['missing','wrong','duplicate','encoded-duplicate','credentials','fragment','path','other-scheme','userinfo','control']) {
    const h = await harness({refresh:false});
    try {
      const { pending } = await h.start(auth => auth.logout());
      const valid = h.validReturn();
      const state = new URL(h.calls.browser[0].url).searchParams.get('state');
      const urls = {
        missing:'balance-dev://logout-callback', wrong:'balance-dev://logout-callback?state=wrong',
        duplicate:`${valid.url}&state=${state}`, 'encoded-duplicate':`${valid.url}&%73tate=${state}`, control:`${valid.url}\n`, credentials:`${valid.url}&token=public-forbidden&code=public-forbidden`,
        fragment:`${valid.url}#token=public-forbidden`, path:`balance-dev://logout-callback/?state=${state}`,
        'other-scheme':`balance://logout-callback?state=${state}`, userinfo:`balance-dev://user@logout-callback?state=${state}`,
      };
      assert.equal(await h.finish(pending,{type:'success',url:urls[variant]}),'unconfirmed',variant);
      assert.equal(h.auth.user,null);
      assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
      assert.equal(h.auth.isLoading,false);
    } finally { await h.close(); }
  }
});

test('real hook cancellation and browser/crypto errors retain local logout and release the owner', async () => {
  for (const failure of ['cancel','browser','crypto']) {
    const h = await harness({ refresh:false,crypto:failure==='crypto' });
    try {
      const { pending } = await h.start(auth => auth.logout());
      if (failure==='browser') h.browser.reject(new Error('synthetic browser failure'));
      assert.equal(await h.finish(pending,{type:'cancel'}),'unconfirmed');
      assert.equal(h.auth.user,null);
      assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
      assert.equal(h.auth.isLoading,false);
    } finally { await h.close(); }
  }
});

test('real hook preserves production revocation-only behavior and rejects wrong native staging context', async () => {
  const revoke = deferred();
  const production = await harness({production:true,revoke});
  try {
    const {pending} = await production.start(auth => auth.logout());
    assert.equal(production.auth.user,null);
    assert.equal(production.auth.isLoading,false,'offline revocation must not own the browser or spinner');
    const login = await production.start(auth => auth.loginWithGoogle());
    assert.equal(production.calls.prompt.length,1,'legacy login remains available during revocation');
    revoke.resolve();
    assert.equal(await pending,'not_requested');
    production.prompt.resolve({type:'cancel'});
    await act(async () => { await login.pending; await flush(); });
    assert.equal(production.auth.isLoading,false);
    assert.equal(production.calls.revoke.length,1);
    assert.equal(production.calls.browser.length,0);
    assert.equal(production.calls.crypto,0);
  } finally { await production.close(); }
  for (const options of [{platform:'web'},{scheme:'balance'},{endpoint:'https://auth.shocker.cl/logout'}]) {
    const h=await harness({...options,refresh:false});
    try {
      const {pending}=await h.start(auth=>auth.logout());
      assert.equal(await pending,'unconfirmed');
      assert.equal(h.calls.browser.length,0);
    } finally { await h.close(); }
  }
});

test('refresh replay drains a running rotation, captures its latest token, and never adopts diagnostic tokens', async () => {
  const rotating = deferred();
  let profileCalls = 0;
  let h;
  h = await harness({ fetch: async () => ++profileCalls === 2
    ? { ok:false, status:401 }
    : { ok:true, status:200, json:async () => ({ data:{ id:7, email:'synthetic@example.invalid' } }) },
  refreshAsync: async (token, count) => {
    if (count === 1) return rotating.promise;
    if (count === 2) return { accessToken:'secret-diag-access', refreshToken:'secret-diag-r1' };
    throw Object.assign(new h.TokenError('synthetic hidden provider detail'), {code:'invalid_grant'});
  }});
  try {
    // A 401 on an otherwise fresh token starts the ordinary refresh.
    const {pending: check} = await h.start(auth => auth.checkSession());
    const replay = h.auth.runRefreshReplay();
    assert.equal(h.calls.refresh.length,1);
    await h.auth.loginWithGoogle();
    assert.equal(h.calls.prompt.length,0);
    rotating.resolve({ accessToken:'synthetic-rotated-access', refreshToken:'synthetic-rotated-refresh', issuedAt:Date.now()/1000 });
    await act(async () => { await check; await flush(); });
    const result = await replay;
    assert.equal(result.status,'PASS');
    assert.equal(profileCalls,2,'verification awaiting old refresh must not fetch /me after diagnostic ownership');
    assert.deepEqual(h.calls.refresh,['public-synthetic-refresh','synthetic-rotated-refresh','synthetic-rotated-refresh','secret-diag-r1']);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    assert.equal(h.auth.user,null);
  } finally { rotating.resolve({}); await h.close(); }
});

test('profile JSON pending before replay cannot republish identity or reconnect after local clear', async () => {
  const profileJson = deferred();
  let profileCalls=0;
  let h;
  h=await harness({fetch:async () => ++profileCalls===1
    ? {ok:true,status:200,json:async()=>({data:{id:7,email:'synthetic@example.invalid'}})}
    : {ok:true,status:200,json:async()=>profileJson.promise},
  refreshAsync:async (_token,count) => count===1
    ? {accessToken:'secret-rotation',refreshToken:'secret-r1'}
    : Promise.reject(Object.assign(new h.TokenError('secret detail'),{code:'invalid_grant'}))});
  try {
    const {pending:check}=await h.start(auth=>auth.checkSession());
    const {pending:replay}=await h.start(auth=>auth.runRefreshReplay());
    profileJson.resolve({data:{id:8,email:'secret-next@example.invalid'}});
    await act(async()=>{await check; await replay; await flush();});
    assert.equal(h.auth.user,null);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    assert.equal(h.calls.sync.filter(value=>value==='connect').length,1);
    assert.equal(JSON.stringify(h.calls.warnings).includes('secret-next'),false);
  } finally {profileJson.resolve({}); await h.close();}
});

test('profile persist completing during replay cannot restore authenticated UI', async () => {
  let profileCalls=0;
  let replay;
  let successfulProfileCommit=false;
  let h;
  h=await harness({afterProfileCommit: run => {
    successfulProfileCommit=true;
    replay=run();
  },fetch:async () => ({ok:true,status:200,json:async()=>({data:
    ++profileCalls===1 ? {id:7,email:'synthetic@example.invalid'} : {id:8,email:'secret-next@example.invalid'}})}),
  refreshAsync:async (_token,count) => count===1
    ? {accessToken:'secret-rotation',refreshToken:'secret-r1'}
    : Promise.reject(Object.assign(new h.TokenError('secret detail'),{code:'invalid_grant'}))});
  try {
    const {pending:check}=await h.start(auth=>auth.checkSession());
    assert.equal(profileCalls,2);
    assert.equal(successfulProfileCommit,true);
    assert(replay);
    await act(async()=>{await check;await replay;await flush();});
    assert.equal(h.auth.user,null);
    assert.equal(h.auth.isAuthenticated,false);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    assert.equal(h.calls.sync.filter(value=>value==='connect').length,1);
  } finally {await h.close();}
});

test('authorized fetch awaiting a prior rotation sends no API request after replay takes ownership', async () => {
  const priorRotation=deferred();
  let h;
  h=await harness({initialExpiresIn:0,refreshAsync:async (_token,count) => {
    if (count===1) return {accessToken:'synthetic-first',refreshToken:'synthetic-first-r',expiresIn:0,issuedAt:Date.now()/1000};
    if (count===2) return priorRotation.promise;
    if (count===3) return {accessToken:'secret-diag',refreshToken:'secret-diag-r'};
    throw Object.assign(new h.TokenError('secret detail'),{code:'invalid_grant'});
  }});
  try {
    const before=h.calls.requests.length;
    const request=h.auth.authorizedFetch('/private');
    await flush();
    assert.equal(h.calls.refresh.length,2);
    const {pending:replay}=await h.start(auth=>auth.runRefreshReplay());
    priorRotation.resolve({accessToken:'synthetic-second',refreshToken:'synthetic-second-r',expiresIn:3600,issuedAt:Date.now()/1000});
    await assert.rejects(request);
    await act(async()=>{await replay;await flush();});
    assert.equal(h.calls.requests.length,before);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
  } finally {priorRotation.resolve({});await h.close();}
});

test('refresh replay rejects unavailable contexts without clearing credentials or contacting provider', async () => {
  for (const options of [{production:true},{platform:'web'},{variant:'daily'},
    {dev:false},{diagFlag:'0'},{scheme:'balance'},{refresh:false},{session:false}]) {
    const h = await harness(options);
    try {
      assert.equal(h.auth.refreshReplayAvailable, !options.production && options.platform !== 'web' &&
        options.variant !== 'daily' && options.dev !== false && options.diagFlag !== '0' &&
        options.scheme !== 'balance');
      const before = h.values.get(sessionState.SESSION_KEY);
      const discovery = h.calls.discovery.length;
      assert.equal(JSON.stringify(await h.auth.runRefreshReplay()), JSON.stringify({status:'UNCONFIRMED',step:'precondition',reason:'unavailable'}));
      assert.equal(h.values.get(sessionState.SESSION_KEY), before);
      assert.equal(h.calls.discovery.length,discovery);
      assert.equal(h.calls.refresh.length,0);
    } finally { await h.close(); }
  }
});

test('storage clear failure stops replay before provider calls and reports durable state as uncertain', async () => {
  const storage=deferred();
  const h=await harness({storage});
  try {
    const before=h.values.get(sessionState.SESSION_KEY);
    const {pending}=await h.start(auth=>auth.runRefreshReplay());
    storage.reject(new Error('secret storage error'));
    let result;
    await act(async()=>{result=await pending;await flush();});
    assert.equal(result.status,'UNCONFIRMED');
    assert.equal(result.reason,'storage');
    assert.equal(h.calls.refresh.length,0);
    assert.equal(h.calls.discovery.length,0);
    assert.equal(h.values.get(sessionState.SESSION_KEY),before);
    assert.equal(h.auth.user,null);
    assert.equal(JSON.stringify(h.calls.warnings).includes('secret storage'),false);
  } finally {storage.resolve();await h.close();}
});

test('refresh replay holds entry points and a timeout latch until the transport settles', async () => {
  const remote = deferred();
  const deadline = {};
  const h = await harness({ deadline, refreshAsync:async () => remote.promise });
  try {
    const {pending} = await h.start(auth => auth.runRefreshReplay());
    assert.equal(h.auth.user,null);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    await act(async () => {
      h.auth.setAuthToken('secret-manual-replacement');
      await h.auth.enableGuestMode();
      await h.auth.loginWithGoogle();
    });
    assert.equal(await h.auth.logout(),'in_progress');
    await h.auth.checkSession('secret-callback-replacement');
    await assert.rejects(h.auth.authorizedFetch('/me'));
    h.appState('active');
    for (const timer of h.scheduled) if (timer.delay !== 30000) timer.callback();
    await flush();
    assert.equal(h.calls.prompt.length,0);
    assert.equal(h.calls.refresh.length,1);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    deadline.callback();
    assert.equal(JSON.stringify(await pending),JSON.stringify({status:'UNCONFIRMED',step:'rotation',reason:'expired'}));
    assert.equal(await h.auth.logout(),'in_progress');
    remote.resolve({accessToken:'secret-late-access',refreshToken:'secret-late-refresh'});
    await act(async () => { await flush(); });
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    assert.equal(h.calls.refresh.length,1);
  } finally { remote.resolve({}); await h.close(); }
});

test('timeout reports the in-flight replay phase and discards its late response', async () => {
  const remote=deferred();
  const deadline={};
  const h=await harness({deadline,refreshAsync:async (_token,count) => count===1
    ? {accessToken:'secret-access',refreshToken:'secret-r1'} : remote.promise});
  try {
    const {pending}=await h.start(auth=>auth.runRefreshReplay());
    assert.equal(h.calls.refresh.length,2);
    deadline.callback();
    const result=await pending;
    assert.equal(result.status,'UNCONFIRMED');
    assert.equal(result.step,'replay');
    assert.equal(await h.auth.logout(),'in_progress');
    remote.resolve({accessToken:'secret-late-access',refreshToken:'secret-late-refresh'});
    await act(async()=>{await flush();});
    assert.equal(h.calls.refresh.length,2);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
  } finally {remote.resolve({});await h.close();}
});

test('a pending authorized request cannot retry its 401 during refresh replay', async () => {
  const apiResponse = deferred();
  const remote = deferred();
  let calls = 0;
  let h;
  h = await harness({fetch:async () => ++calls === 1
    ? {ok:true,status:200,json:async () => ({data:{id:7,email:'synthetic@example.invalid'}})}
    : apiResponse.promise, refreshAsync:async (_token,count) => {
      if (count===1) return remote.promise;
      throw Object.assign(new h.TokenError('secret detail'),{code:'invalid_grant'});
    }});
  try {
    const request = h.auth.authorizedFetch('/private');
    await flush();
    const {pending:replay} = await h.start(auth => auth.runRefreshReplay());
    apiResponse.resolve({ok:false,status:401});
    assert.equal((await request).status,401);
    assert.equal(calls,2);
    assert.equal(h.calls.refresh.length,1);
    remote.resolve({accessToken:'secret-a',refreshToken:'secret-b'});
    await act(async () => { await replay; await flush(); });
    assert.equal(h.calls.refresh.length,3);
  } finally { apiResponse.resolve({ok:false,status:401}); remote.resolve({}); await h.close(); }
});

test('refresh replay distinguishes typed rejection, generic failure and accepted reuse', async () => {
  for (const outcome of ['pass','accepted','network','repeated','empty','family-accepted']) {
    let h;
    h = await harness({refreshAsync:async (token,count) => {
      if (count===1) return {accessToken:'secret-access',refreshToken:outcome==='repeated' ? token : outcome==='empty' ? '' : 'secret-r1'};
      if (outcome==='network') throw new Error('secret response details');
      if (outcome==='accepted' || outcome==='family-accepted' && count===3)
        return {accessToken:'secret-accepted',refreshToken:'secret-accepted-refresh'};
      throw Object.assign(new h.TokenError('secret response details'),{code:'invalid_grant'});
    }});
    try {
      let result;
      await act(async () => { result=await h.auth.runRefreshReplay(); });
      const expected = outcome==='pass' ? 'PASS' : outcome==='accepted' || outcome==='family-accepted' ? 'FAIL' : 'UNCONFIRMED';
      assert.equal(result.status,expected,outcome);
      if (outcome==='accepted') assert.equal(result.step,'replay');
      if (outcome==='family-accepted') assert.equal(result.step,'family');
      assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
      assert.equal(h.auth.user,null);
      assert.equal(JSON.stringify(result).includes('secret'),false);
      assert.equal(JSON.stringify(h.calls.warnings).includes('secret'),false);
    } finally { await h.close(); }
  }
});
