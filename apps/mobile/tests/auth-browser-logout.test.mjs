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
    idToken: options.idToken,
    issuedAt: Math.floor(Date.now() / 1000), expiresIn: options.initialExpiresIn,
    lineage: 'synthetic-family', binding,
  }));
  else if (options.loggedOut) values.set(sessionState.SESSION_KEY, sessionState.LOGGED_OUT_MARKER);
  const calls = { discovery: [], refresh: [], revoke: [], browser: [], prompt: [], crypto: 0, sync: [], templates: 0, warnings: [], requests: [], writes: [] };
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
    revokeAsync: async request => { calls.revoke.push(request); if (options.revoke) await options.revoke.promise;
      if (options.revokeAsync) return options.revokeAsync(request,calls.revoke.length);
      return options.revokeResult ?? true; },
    exchangeCodeAsync: async request => options.exchangeCodeAsync
      ? options.exchangeCodeAsync(request, calls.prompt.length)
      : { accessToken: 'public-next-access', refreshToken: 'public-next-refresh', issuedAt: Date.now()/1000 },
    refreshAsync: async request => { calls.refresh.push(request.refreshToken); if (options.refreshAsync) return options.refreshAsync(request.refreshToken, calls.refresh.length); throw new Error('unexpected refresh'); },
    AuthRequest: class {
      codeVerifier = 'public-synthetic-code-verifier';
      constructor(request) { this.request = request; }
      promptAsync(_discovery, promptOptions) { calls.prompt.push({ ...this.request, promptOptions });
        return options.promptAsync ? options.promptAsync(this.request, calls.prompt.length) : prompt.promise; }
    },
  };
  const secure = {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (value === sessionState.LOGGED_OUT_MARKER && options.storage) await options.storage.promise;
      calls.writes.push({key,value});
      values.set(key, value);
    },
    deleteItemAsync: async key => { values.delete(key); },
  };
  const config = {
    API_BASE_URL: binding.apiBaseUrl, OIDC_ISSUER: binding.issuer,
    OIDC_MOBILE_CLIENT_ID: binding.clientId, OIDC_RESOURCE: binding.resource,
    OIDC_REDIRECT_URI: options.redirectUri,
    OIDC_LOGOUT_ID_TOKEN_HINT: options.hintFlag ?? false,
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
      assert.equal(count, options.cryptoCount ?? 32);
      return options.cryptoBytes ? Uint8Array.from({length:count},(_,index)=>index) : new Uint8Array(count).fill(calls.crypto);
    } };
    if (name === 'expo-secure-store') return secure;
    if (name === 'react-native') return { Platform: { OS: options.platform ?? 'android' }, AppState: { addEventListener: (_event, listener) => { appStateListener = listener; return { remove() {} }; } } };
    if (name === 'expo-constants') return { expoConfig: { scheme: options.scheme ?? (options.production ? 'balance' : 'balance-dev'), extra: { appVariant: options.variant ?? (options.production ? 'production' : 'development') } } };
    if (name === '@/services/config') return config;
    if (name === '@/services/auth/session-state') return authState;
    if (name === '@/services/storage') return { storage: {
      getItem: async key => values.get(key) ?? null,
      setItem: async (key, value) => { if (key === '@balance_guest_v1' && options.guestStorage) await options.guestStorage.promise;
        values.set(key,value); }, removeItem: async key => { values.delete(key); },
    } };
    if (name === '@/services/sync/sync-client') return { syncClient: {
      disconnect: () => calls.sync.push('disconnect'), setNamespace: namespace => calls.sync.push(namespace), connect: () => calls.sync.push('connect'),
    } };
    if (name === '@/services/sync/official-templates') return { fetchOfficialTemplates: async () => {
      calls.templates++; if (options.templatesPending) await options.templatesPending.promise;
    } };
    throw new Error(`Unexpected module ${name}`);
  };
  runInNewContext(code, { module, exports: module.exports, require, URL, Uint8Array, Headers,
    __DEV__: options.dev ?? true, process: { env: { EXPO_PUBLIC_AUTH_DIAGNOSTICS: options.diagFlag ?? '1' } },
    console: { warn: (...values) => calls.warnings.push(values) },
    fetch: async (...args) => { calls.requests.push(args[0]); return options.fetch ? options.fetch(...args) : { ok: true, status: 200, json: async () => ({ data: { id: 7, email: 'synthetic@example.invalid' } }) }; },
    setTimeout: (callback, delay) => { if (delay === 30000 && options.deadline) { options.deadline.callback = callback; return 0; }
      if (delay === 300000 && options.overallDeadline) { options.overallDeadline.callback = callback; return 0; }
      scheduled.push({callback,delay}); const timer = setTimeout(callback, delay); timers.add(timer); return timer; },
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
      options.revoke?.resolve(); options.storage?.resolve(); options.templatesPending?.resolve();
      await act(async () => { renderer.unmount(); await flush(); });
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

test('provider logout uses two fresh nonce-bound families, revokes A before browser, and leaves server proof pending', async () => {
  let h;
  h=await harness({session:false,loggedOut:true,cryptoCount:64,cryptoBytes:true,hintFlag:true,
    promptAsync:async (_request,count)=>({type:'success',params:{code:`synthetic-code-${count}`,iss:stage.issuer}}),
    exchangeCodeAsync:async (_request,count)=>({accessToken:`secret-${count}-access`,refreshToken:`secret-${count}-refresh`,idToken:`secret-${count}-id`,issuedAt:Date.now()/1000}),
    refreshAsync:async (_token,count)=>{
      if (count<=2) return {accessToken:`secret-rotated-${count}`,refreshToken:`secret-rotated-refresh-${count}`,issuedAt:Date.now()/1000};
      throw Object.assign(new h.TokenError('secret rejection'),{code:'invalid_grant'});
    }});
  try {
    assert.equal(h.auth.providerLogoutAvailable,true);
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    assert.equal(h.calls.prompt.length,2);
    assert.equal(h.calls.refresh.length,2);
    assert.equal(h.calls.revoke.length,1);
    assert.equal(h.calls.browser.length,1);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    assert.equal(h.calls.revoke[0].token,'secret-rotated-refresh-1');
    assert.equal(new URL(h.calls.browser[0].url).searchParams.get('id_token_hint'),'secret-1-id');
    assert.equal(JSON.stringify(h.calls.revoke).includes('secret-1-id'),false);
    await h.auth.loginWithGoogle();
    assert.equal(await h.auth.logout(),'in_progress');
    assert.equal(await h.auth.enableGuestMode(),false);
    h.auth.setAuthToken('secret-manual');
    await h.auth.checkSession('secret-callback');
    await assert.rejects(h.auth.authorizedFetch('/private'));
    h.appState('active');
    for (const timer of h.scheduled) if (timer.delay !== 30000 && timer.delay !== 300000) timer.callback();
    assert.equal(h.calls.prompt.length,2);
    assert.equal(h.calls.refresh.length,2);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    const reference='000102030405060708090a0b0c0d0e0f';
    assert.equal(h.calls.prompt[0].extraParams.nonce,`bal033v1.${reference}.A.101112131415161718191a1b1c1d1e1f`);
    assert.equal(h.calls.prompt[1].extraParams.nonce,`bal033v1.${reference}.B.202122232425262728292a2b2c2d2e2f`);
    assert.equal(h.calls.prompt[0].promptOptions.preferEphemeralSession,false);
    assert.equal(new URL(h.calls.browser[0].url).searchParams.get('state'),`${reference}303132333435363738393a3b3c3d3e3f`);
    const callback=h.validReturn();
    h.browser.resolve(callback);
    let outcome;
    await act(async()=>{outcome=await pending;await flush();});
    assert.equal(outcome.status,'UNCONFIRMED');
    assert.equal(outcome.reason,'provider_proof_pending');
    assert.equal(outcome.revocationConfirmed,true);
    assert.equal(outcome.reference,reference);
    assert.equal(h.auth.providerLogoutNotice.reference,reference);
    assert.equal(h.calls.refresh.length,3);
    assert.equal(h.calls.refresh[2],'secret-rotated-refresh-2');
    assert.equal(h.calls.revoke.length,1,'typed invalid_grant already proves B cannot be renewed');
    assert.equal(h.auth.user,null);
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    assert.deepEqual(h.calls.writes.filter(write=>write.key===sessionState.SESSION_KEY).map(write=>write.value),
      [sessionState.LOGGED_OUT_MARKER], 'neither diagnostic family is ever persisted');
    assert.equal(h.calls.requests.length,0,'diagnostic families are not used for the profile API');
    assert.equal(h.calls.sync.includes('connect'),false);
    assert.equal(JSON.stringify(outcome).includes('secret-'),false);
  } finally {await h.close();}
});

async function providerHarness(options={}) {
  let h;
  h=await harness({session:false,loggedOut:true,cryptoCount:64,cryptoBytes:true,hintFlag:true,
    promptAsync:async (_request,count)=>({type:'success',params:{code:`synthetic-code-${count}`,iss:stage.issuer}}),
    exchangeCodeAsync:async (_request,count)=>({accessToken:`secret-${count}-access`,refreshToken:`secret-${count}-refresh`,idToken:`secret-${count}-id`,issuedAt:Date.now()/1000}),
    refreshAsync:async (_token,count)=>{
      if (count<=2) return {accessToken:`secret-rotated-${count}`,refreshToken:`secret-rotated-refresh-${count}`,issuedAt:Date.now()/1000};
      throw Object.assign(new h.TokenError('secret rejection'),{code:'invalid_grant'});
    },...options});
  const close=h.close;
  h.close=async()=>{
    try {
      if (options.assertDiagnosticWrites !== false)
        assert.equal(h.calls.writes.filter(write=>write.key===sessionState.SESSION_KEY)
          .every(write=>write.value===sessionState.LOGGED_OUT_MARKER),true,
        'diagnostic A/B must stay in memory on every success and failure path');
    } finally {await close();}
  };
  return h;
}

async function loginScreenFor(auth) {
  const routes=[];
  const module={exports:{}};
  const code=ts.transpileModule(readFileSync(new URL('../src/app/login.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText;
  const component=name=>({children,...props})=>React.createElement(name,props,children);
  const nativeRequire=createRequire(import.meta.url);
  const require=name=>{
    if (name==='react') return nativeRequire('react');
    if (name==='react-native') return {StyleSheet:{create:value=>value},TouchableOpacity:component('TouchableOpacity'),View:component('View')};
    if (name==='expo-router') return {useRouter:()=>({replace:path=>routes.push(path)})};
    if (name==='@/hooks/use-auth') return {useAuth:()=>auth};
    if (name==='@/theme') return {useTheme:()=>({space:new Proxy({},{get:()=>1}),colors:new Proxy({},{get:()=>"black"}),border:{hairline:1},radius:{pill:1}})};
    if (name==='@/components/ui') return Object.fromEntries(['Button','Card','Screen','Text'].map(key=>[key,component(key)]));
    throw new Error(`Unexpected Login dependency ${name}`);
  };
  runInNewContext(code,{module,exports:module.exports,require});
  let renderer;
  await act(async()=>{renderer=TestRenderer.create(React.createElement(module.exports.default));await flush();});
  return {routes,guestButton:()=>renderer.root.findByType('TouchableOpacity'),close:async()=>{await act(async()=>renderer.unmount());}};
}

test('Login guest control navigates only after actual provider confirms guest mode', async () => {
  const busy=await providerHarness();
  const {pending}=await busy.start(auth=>auth.runProviderLogoutDiagnostic());
  const busyScreen=await loginScreenFor(busy.auth);
  try {
    assert.equal(busyScreen.guestButton().props.disabled,true);
    await act(async()=>{await busyScreen.guestButton().props.onPress();await flush();});
    assert.deepEqual(busyScreen.routes,[]);
    assert.equal(busy.auth.isGuest,false);
    busy.browser.resolve(busy.validReturn());
    await act(async()=>{await pending;await flush();});
  } finally {await busyScreen.close();await busy.close();}

  const templatesPending=deferred();
  const available=await providerHarness({templatesPending});
  const availableScreen=await loginScreenFor(available.auth);
  try {
    assert.equal(availableScreen.guestButton().props.disabled,false);
    await act(async()=>{await availableScreen.guestButton().props.onPress();await flush();});
    assert.deepEqual(availableScreen.routes,['/(tabs)/logs']);
    assert.equal(available.auth.isGuest,true);
    assert.equal(available.calls.templates,1);
  } finally {templatesPending.resolve();await availableScreen.close();await available.close();}
});

test('guest-mode completion reports false after a newer credential generation takes ownership', async () => {
  const storage=deferred();
  const h=await providerHarness({storage,assertDiagnosticWrites:false});
  try {
    const {pending}=await h.start(auth=>auth.enableGuestMode());
    h.auth.setAuthToken('secret-replacement');
    let entered;
    await act(async()=>{storage.resolve();entered=await pending;await flush();});
    assert.equal(entered,false);
    assert.equal(h.auth.isGuest,false);
    assert.equal(h.values.get('@balance_guest_v1'),undefined);
  } finally {storage.resolve();await h.close();}
});

test('provider logout establishes the durable marker on first use before any authorization', async () => {
  let h;
  h=await providerHarness({loggedOut:false,promptAsync:async (_request,count)=>{
    if (count === 1) assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    assert.equal(h.calls.writes[0]?.value,sessionState.LOGGED_OUT_MARKER);
    return {type:'success',params:{code:`synthetic-code-${count}`,iss:stage.issuer}};
  }});
  try {
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    assert.equal(h.calls.prompt.length,2);
    h.browser.resolve(h.validReturn());
    let outcome;
    await act(async()=>{outcome=await pending;await flush();});
    assert.equal(outcome.reason,'provider_proof_pending');
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
  } finally {await h.close();}
});

test('provider logout leaves an earlier guest transition waiting on marker storage intact', async () => {
  const storage=deferred();
  const h=await providerHarness({loggedOut:false,storage});
  try {
    const {pending:guest}=await h.start(auth=>auth.enableGuestMode());
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    assert.equal((await pending).reason,'unavailable');
    assert.equal(h.calls.prompt.length,0);
    let guestResult;
    await act(async()=>{storage.resolve();guestResult=await guest;await flush();});
    assert.equal(guestResult,true);
    assert.equal(h.auth.isGuest,true);
    assert.equal(h.values.get('@balance_guest_v1'),'1');
    assert.equal(h.calls.sync.includes('guest'),true);
    assert.equal(h.calls.templates,1);
    assert.equal(h.calls.prompt.length,0);
  } finally {storage.resolve();await h.close();}
});

test('provider logout rejects a pending guest write and a completed guest seen through a stale closure', async () => {
  const guestStorage=deferred();
  const h=await providerHarness({guestStorage});
  try {
    const staleAuth=h.auth;
    const {pending:guest}=await h.start(auth=>auth.enableGuestMode());
    assert.equal((await staleAuth.runProviderLogoutDiagnostic()).reason,'unavailable');
    assert.equal(h.calls.prompt.length,0);
    await act(async()=>{guestStorage.resolve();await guest;await flush();});
    assert.equal(h.auth.isGuest,true);
    assert.equal(h.values.get('@balance_guest_v1'),'1');
    assert.equal((await staleAuth.runProviderLogoutDiagnostic()).reason,'unavailable');
    assert.equal(h.calls.prompt.length,0);
    assert.equal(h.values.get('@balance_guest_v1'),'1');
  } finally {guestStorage.resolve();await h.close();}
});

test('provider logout leaves an unexpected stored record untouched and enforces the exact Dev gate', async () => {
  for (const options of [{production:true},{variant:'daily'},{platform:'web'},
    {scheme:'balance'},{diagFlag:'0'},{dev:false}]) {
    const h=await providerHarness(options);
    try {
      const before=h.values.get(sessionState.SESSION_KEY);
      const result=await h.auth.runProviderLogoutDiagnostic();
      assert.equal(result.reason,'unavailable');
      assert.equal(h.calls.prompt.length,0);
      assert.equal(h.calls.discovery.length,0);
      assert.equal(h.calls.refresh.length,0);
      assert.equal(h.values.get(sessionState.SESSION_KEY),before);
    } finally {await h.close();}
  }
  const h=await providerHarness();
  try {
    h.values.set(sessionState.SESSION_KEY,'foreign-record');
    const result=await h.auth.runProviderLogoutDiagnostic();
    assert.equal(result.reason,'unavailable');
    assert.equal(h.values.get(sessionState.SESSION_KEY),'foreign-record');
    assert.equal(h.calls.prompt.length,0);
    assert.equal(h.calls.writes.length,0);
  } finally {await h.close();}
});

test('provider logout cancellation or wrong callback cleans both captured families without probing B', async () => {
  for (const callback of ['cancel','wrong']) {
    const h=await providerHarness();
    try {
      const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
      h.browser.resolve(callback==='cancel' ? {type:'cancel'} : {type:'success',url:'balance-dev://logout-callback?state=wrong'});
      let outcome;
      await act(async()=>{outcome=await pending;await flush();});
      assert.equal(outcome.status,'UNCONFIRMED');
      assert.equal(outcome.reason,'cancelled');
      assert.equal(h.calls.refresh.length,2);
      assert.equal(h.calls.revoke.length,2);
      assert.equal(h.calls.revoke[1].token,'secret-rotated-refresh-2');
      assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    } finally {await h.close();}
  }
});

test('post-logout B acceptance is a local failure and its successor is revoked without adoption', async () => {
  const h=await providerHarness({refreshAsync:async (_token,count)=>({
    accessToken:`secret-rotated-${count}`,refreshToken:`secret-rotated-refresh-${count}`,issuedAt:Date.now()/1000,
  })});
  try {
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    h.browser.resolve(h.validReturn());
    let outcome;
    await act(async()=>{outcome=await pending;await flush();});
    assert.equal(outcome.status,'FAIL');
    assert.equal(outcome.reason,'accepted');
    assert.equal(h.calls.revoke.at(-1).token,'secret-rotated-refresh-3');
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
    assert.equal(h.auth.user,null);
  } finally {await h.close();}
});

test('B acceptance remains FAIL when cleanup revocation returns false or throws', async () => {
  for (const cleanup of ['false','throw']) {
    const h=await providerHarness({
      refreshAsync:async (_token,count)=>({accessToken:`secret-${count}`,refreshToken:`secret-rotated-refresh-${count}`,issuedAt:Date.now()/1000}),
      revokeAsync:async (_request,count)=>{
        if (count===1) return true;
        if (cleanup==='throw') throw new Error('secret cleanup error');
        return false;
      },
    });
    try {
      const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
      h.browser.resolve(h.validReturn());
      let outcome;
      await act(async()=>{outcome=await pending;await flush();});
      assert.equal(outcome.status,'FAIL');
      assert.equal(outcome.reason,'accepted');
      assert.equal(outcome.cleanupIssue,'revoke');
      assert.equal(h.auth.providerLogoutNotice.status,'FAIL');
      assert.equal(h.auth.providerLogoutNotice.cleanupIssue,'revoke');
      assert.equal(JSON.stringify(outcome).includes('secret'),false);
    } finally {await h.close();}
  }
});

test('B acceptance stays visible during a timed-out cleanup, then reports its cleanup issue', async () => {
  const cleanup=deferred();
  const overallDeadline={};
  const h=await providerHarness({overallDeadline,
    refreshAsync:async (_token,count)=>({accessToken:`secret-${count}`,refreshToken:`secret-rotated-refresh-${count}`,issuedAt:Date.now()/1000}),
    revokeAsync:async (_request,count)=>count===1 ? true : cleanup.promise,
  });
  try {
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    h.browser.resolve(h.validReturn());
    await act(async()=>{await flush();});
    assert.equal(h.calls.revoke.length,2);
    assert.equal(h.auth.providerLogoutNotice.status,'FAIL');
    overallDeadline.callback();
    assert.equal((await pending).status,'FAIL');
    assert.equal(await h.auth.logout(),'in_progress');
    cleanup.resolve(false);
    await act(async()=>{await flush();});
    assert.equal(h.auth.providerLogoutNotice.status,'FAIL');
    assert.equal(h.auth.providerLogoutNotice.cleanupIssue,'revoke');
  } finally {cleanup.resolve(false);await h.close();}
});

test('a late accepted B probe upgrades an earlier timeout notice to FAIL', async () => {
  const lateProbe=deferred();
  const overallDeadline={};
  const h=await providerHarness({overallDeadline,
    refreshAsync:async (_token,count)=>count===3 ? lateProbe.promise
      : {accessToken:`secret-${count}`,refreshToken:`secret-rotated-refresh-${count}`,issuedAt:Date.now()/1000},
  });
  try {
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    h.browser.resolve(h.validReturn());
    await act(async()=>{await flush();});
    assert.equal(h.calls.refresh.length,3);
    await act(async()=>{overallDeadline.callback();await flush();});
    assert.equal((await pending).reason,'expired');
    assert.equal(h.auth.providerLogoutNotice.status,'UNCONFIRMED');
    assert.equal(await h.auth.logout(),'in_progress');
    lateProbe.resolve({accessToken:'secret-late',refreshToken:'secret-late-successor',issuedAt:Date.now()/1000});
    await act(async()=>{await flush();});
    assert.equal(h.auth.providerLogoutNotice.status,'FAIL');
    assert.equal(h.auth.providerLogoutNotice.reason,'accepted');
    assert.equal(h.calls.revoke.at(-1).token,'secret-late-successor');
  } finally {lateProbe.resolve({});await h.close();}
});

test('provider logout late B rotation after SDK deadline is revoked, never followed by browser logout', async () => {
  const pendingB=deferred();
  const deadline={};
  const h=await providerHarness({deadline,refreshAsync:async (_token,count)=>count===2
    ? pendingB.promise : {accessToken:`secret-rotated-${count}`,refreshToken:`secret-rotated-refresh-${count}`,issuedAt:Date.now()/1000}});
  try {
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    assert.equal(h.calls.refresh.length,2);
    deadline.callback();
    const outcome=await pending;
    assert.equal(outcome.reason,'expired');
    assert.equal(outcome.step,'refresh_b');
    assert.equal(await h.auth.logout(),'in_progress');
    pendingB.resolve({accessToken:'secret-late-b',refreshToken:'secret-late-b-refresh'});
    await act(async()=>{await flush();});
    assert.equal(h.calls.browser.length,0);
    assert.equal(h.calls.revoke.at(-1).token,'secret-late-b-refresh');
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
  } finally {pendingB.resolve({});await h.close();}
});

test('provider logout waits for B exchange after deadline and revokes its late family', async () => {
  const exchangeB=deferred();
  const deadline={};
  const h=await providerHarness({deadline,exchangeCodeAsync:async (_request,count)=>count===2
    ? exchangeB.promise : {accessToken:'secret-a',refreshToken:'secret-a-refresh',issuedAt:Date.now()/1000}});
  try {
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    assert.equal(h.calls.prompt.length,2);
    assert.equal(h.calls.refresh.length,0);
    deadline.callback();
    assert.equal((await pending).reason,'expired');
    assert.equal(await h.auth.logout(),'in_progress');
    exchangeB.resolve({accessToken:'secret-late-b',refreshToken:'secret-late-b-refresh',issuedAt:Date.now()/1000});
    await act(async()=>{await flush();});
    assert.equal(h.calls.browser.length,0);
    assert.equal(h.calls.revoke.at(-1).token,'secret-late-b-refresh');
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
  } finally {exchangeB.resolve({});await h.close();}
});

test('provider logout browser timeout holds owner and stops the B probe after callback', async () => {
  const overallDeadline={};
  const h=await providerHarness({overallDeadline});
  try {
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    assert.equal(h.calls.browser.length,1);
    overallDeadline.callback();
    assert.equal((await pending).reason,'expired');
    assert.equal(await h.auth.logout(),'in_progress');
    h.browser.resolve(h.validReturn());
    await act(async()=>{await flush();});
    assert.equal(h.calls.refresh.length,2);
    assert.equal(h.calls.revoke.at(-1).token,'secret-rotated-refresh-2');
    assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
  } finally {await h.close();}
});

test('provider logout refuses browser transition when A revocation is unconfirmed', async () => {
  const h=await providerHarness({revokeResult:false});
  try {
    let outcome;
    await act(async()=>{outcome=await h.auth.runProviderLogoutDiagnostic();await flush();});
    assert.equal(outcome.status,'UNCONFIRMED');
    assert.equal(outcome.reason,'cleanup');
    assert.equal(outcome.revocationConfirmed,false);
    assert.equal(h.calls.browser.length,0);
    assert.equal(h.calls.refresh.length,2);
    assert.equal(h.calls.revoke.length,3);
  } finally {await h.close();}
});

test('provider logout storage clear failure prevents browser and reports uncertain persistence', async () => {
  const storage=deferred();
  const h=await providerHarness({storage});
  try {
    const {pending}=await h.start(auth=>auth.runProviderLogoutDiagnostic());
    assert.equal(h.calls.refresh.length,2);
    storage.reject(new Error('secret storage failure'));
    let outcome;
    await act(async()=>{outcome=await pending;await flush();});
    assert.equal(outcome.reason,'storage');
    assert.equal(h.calls.browser.length,0);
    assert.equal(h.calls.revoke.length,2);
    assert.equal(JSON.stringify(h.calls.warnings).includes('secret storage'),false);
  } finally {storage.resolve();await h.close();}
});


test('normal and diagnostic authorization exchange retain the chosen HTTPS redirect', async () => {
  const redirectUri = 'https://balance-staging.shocker.cl/auth-callback';
  for (const diagnostic of [false, true]) {
    const exchanges = [];
    const h = await harness({ redirectUri, session: false, loggedOut: true,
      cryptoCount: diagnostic ? 64 : 32,
      promptAsync: async () => ({ type: 'success', params: { code: 'synthetic-code', iss: stage.issuer } }),
      exchangeCodeAsync: async request => { exchanges.push(request); return { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', issuedAt: Date.now()/1000 }; },
    });
    try {
      if (diagnostic) {
        await h.start(auth => auth.runProviderLogoutDiagnostic());
      } else {
        await h.start(auth => auth.loginWithGoogle());
      }
      await flush();
      assert.ok(h.calls.prompt.length >= (diagnostic ? 2 : 1));
      for (const request of h.calls.prompt) {
        assert.equal(request.redirectUri, redirectUri);
        assert.equal(request.usePKCE, true);
        assert.equal(request.responseType, 'code');
      }
      assert.ok(exchanges.length >= (diagnostic ? 2 : 1));
      for (const request of exchanges) assert.equal(request.redirectUri, redirectUri);
    } finally { await h.close(); }
  }
});

test('callback route ignores URL credentials in staging and preserves legacy production', async () => {
  const source = ts.transpileModule(readFileSync(new URL('../src/app/auth-callback.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  for (const production of [false, true]) {
    const calls = [];
    const binding = production ? legacy : stage;
    const module = { exports: {} };
    const require = name => {
      if (name === 'react') return { ...React, useEffect: effect => effect() };
      if (name === 'react-native') return { View: 'View', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: value => value } };
      if (name === 'expo-router') return { useLocalSearchParams: () => ({ token: 'synthetic-url-token', code: 'synthetic-code' }), useRouter: () => ({ replace: path => calls.push(['route', path]) }) };
      if (name === '@/hooks/use-auth') return { useAuth: () => ({ setAuthToken: value => calls.push(['token', value]), checkSession: async value => calls.push(['check', value]) }) };
      if (name === '@/services/config') return { OIDC_ISSUER: binding.issuer, OIDC_MOBILE_CLIENT_ID: binding.clientId };
      if (name === '@/services/auth/session-state') return sessionState;
      if (name === '@/theme') return { useTheme: () => ({ colors: {}, space: {} }) };
      if (name === '@/components/ui') return { Text: 'Text' };
      throw new Error(name);
    };
    runInNewContext(source, { module, exports: module.exports, require });
    module.exports.default();
    await flush();
    assert.equal(calls.some(([kind]) => kind === 'token'), production);
    assert.equal(calls.some(([kind]) => kind === 'check'), production);
    assert.equal(calls.at(-1)[0], 'route');
  }
});


test('real hook native hint is captured before clear and requires explicit provider support', async () => {
  for (const hintFlag of [undefined,false,true]) {
    const h=await harness({idToken:'original-login-id',hintFlag});
    try {
      const {pending}=await h.start(auth=>auth.logout());
      assert.equal(h.values.get(sessionState.SESSION_KEY),sessionState.LOGGED_OUT_MARKER);
      assert.equal(new URL(h.calls.browser[0].url).searchParams.get('id_token_hint'),hintFlag ? 'original-login-id' : null);
      assert.equal(await h.finish(pending,{type:'cancel'}),'unconfirmed');
      for (const output of [h.calls.revoke,h.calls.requests,h.calls.warnings]) assert.equal(JSON.stringify(output).includes('original-login-id'),false);
    } finally {await h.close();}
  }
});

test('real hook new native login retains original hint across refresh and replacement login cannot inherit it', async () => {
  let count=0;
  const h=await harness({idToken:'old-id',hintFlag:true,
    promptAsync:async()=>({type:'success',params:{code:'synthetic',iss:stage.issuer}}),
    exchangeCodeAsync:async()=>({accessToken:'new-access',refreshToken:'new-refresh',idToken:++count===1?'original-id':undefined,issuedAt:Date.now()/1000,expiresIn:120}),
    refreshAsync:async()=>({accessToken:'rotated',refreshToken:'rotated-refresh',idToken:'ignored-refresh-id',issuedAt:Date.now()/1000,expiresIn:120})});
  try {
    await act(async()=>{await h.auth.loginWithGoogle();await flush();});
    assert.equal(JSON.parse(h.values.get(sessionState.SESSION_KEY)).idToken,'original-id');
    const timer=h.scheduled.find(timer=>timer.delay>=59000&&timer.delay<=61000);
    assert(timer);
    await act(async()=>{timer.callback();await flush();});
    assert.equal(JSON.parse(h.values.get(sessionState.SESSION_KEY)).idToken,'original-id');
    await act(async()=>{await h.auth.loginWithGoogle();await flush();});
    assert.equal(JSON.parse(h.values.get(sessionState.SESSION_KEY)).idToken,undefined);
  } finally {await h.close();}
});


test('real hook web login and hydration never retain an ID token', async () => {
  const h=await harness({platform:'web',idToken:'native-only-id',hintFlag:true,
    promptAsync:async()=>({type:'success',params:{code:'synthetic',iss:stage.issuer}}),
    exchangeCodeAsync:async()=>({accessToken:'web-access',refreshToken:'web-refresh',idToken:'provider-web-id',issuedAt:Date.now()/1000})});
  try {
    assert.equal(JSON.parse(h.values.get(sessionState.SESSION_KEY)).idToken,undefined);
    await act(async()=>{await h.auth.loginWithGoogle();await flush();});
    const stored=JSON.parse(h.values.get(sessionState.SESSION_KEY));
    assert.equal(stored.idToken,undefined);
    assert.equal(stored.refreshToken,undefined);
    const {pending}=await h.start(auth=>auth.logout());
    assert.equal(await pending,'unconfirmed');
    assert.equal(h.calls.browser.length,0);
  } finally {await h.close();}
});

test('real hook malformed hint cannot hydrate a session', async () => {
  const h=await harness({idToken:{invalid:true},hintFlag:true});
  try {
    assert.equal(h.auth.user,null);
    assert.equal(h.auth.isAuthenticated,false);
    assert.equal(h.calls.requests.length,0);
  } finally {await h.close();}
});
