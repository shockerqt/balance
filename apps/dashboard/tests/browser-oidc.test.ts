import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OIDC_TRANSACTION_MAX_AGE_MS,
  authorizationCodeBody,
  buildAuthorizationUrl,
  discoverOidc,
  refreshTokenBody,
  revokeRefreshToken,
  PendingOidcCredentials,
  parseOidcCallback,
  pkceChallenge,
  type OidcTransaction,
} from '../src/services/auth/browser-oidc.ts';
import type { DashboardServiceConfig } from '../src/services/config.ts';

const transaction: OidcTransaction = {
  version: 1,
  state: 'state-1234567890123456',
  verifier: 'verifier-abcdefghijklmnopqrstuvwxyz-1234567890-ABCDE',
  redirectUri: 'https://balance.shocker.cl/',
  returnTo: '/',
  prompt: 'login',
  createdAt: 1_000,
};

const config: DashboardServiceConfig = {
  apiBaseUrl: 'https://balance.shocker.cl/api',
  wsSyncUrl: 'wss://balance.shocker.cl/api/ws/sync',
  oidcIssuer: 'https://auth.shocker.cl/realms/balance',
  oidcClientId: 'balance-mobile',
  oidcRedirectUri: 'https://balance.shocker.cl/',
};

test('PKCE challenge matches the RFC 7636 S256 vector', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(await pkceChallenge(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('OIDC callback accepts only the matching live transaction', () => {
  const valid = parseOidcCallback('?code=abc&state=state-1234567890123456', transaction, 2_000);
  assert.equal(valid.type, 'code');

  const mismatch = parseOidcCallback('?code=abc&state=wrong', transaction, 2_000);
  assert.deepEqual(mismatch, { type: 'invalid', reason: 'state mismatch' });

  const expired = parseOidcCallback(
    '?code=abc&state=state-1234567890123456',
    transaction,
    transaction.createdAt + OIDC_TRANSACTION_MAX_AGE_MS + 1,
  );
  assert.deepEqual(expired, { type: 'invalid', reason: 'expired transaction' });
});

test('authorization code exchange carries PKCE but no bearer credential', () => {
  const body = authorizationCodeBody(config, 'authorization-code', transaction);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code_verifier'), transaction.verifier);
  assert.equal(body.get('client_id'), 'balance-mobile');
  assert.equal(body.has('refresh_token'), false);
  assert.equal(body.has('access_token'), false);

  const persistedTransaction = JSON.stringify(transaction);
  assert.equal(persistedTransaction.includes('accessToken'), false);
  assert.equal(persistedTransaction.includes('refreshToken'), false);
});

for (const issuer of [config.oidcIssuer, 'https://eri.example.test', 'http://127.0.0.1:8180/realms/balance-e2e']) {
  test(`standard discovery and PKCE authorization: ${issuer}`, async () => {
    const provider = { ...config, oidcIssuer: issuer };
    const prefix = issuer === config.oidcIssuer ? `${issuer}/protocol/openid-connect` : issuer;
    const metadata = { issuer, authorization_endpoint: `${prefix}/auth`, token_endpoint: `${prefix}/token` };
    const discovery = await discoverOidc(provider, async (url, options) => {
      assert.equal(url, `${issuer}/.well-known/openid-configuration`);
      assert.equal(options?.credentials, 'omit');
      assert.equal(options?.redirect, 'error');
      return Response.json(metadata);
    });
    assert.deepEqual(discovery, metadata);
    const url = new URL(await buildAuthorizationUrl(provider, { ...transaction, prompt: 'none' }, discovery));
    assert.equal(url.origin + url.pathname, metadata.authorization_endpoint);
    assert.equal(url.searchParams.get('state'), transaction.state);
    assert.equal(url.searchParams.get('code_challenge'), await pkceChallenge(transaction.verifier));
    assert.equal(url.searchParams.get('client_id'), config.oidcClientId);
    assert.equal(url.searchParams.get('prompt'), 'none');
  });
}
const metadata = { issuer: config.oidcIssuer, authorization_endpoint: 'https://auth.shocker.cl/authorize', token_endpoint: 'https://auth.shocker.cl/token' };
for (const invalid of [null, {}, { ...metadata, issuer: `${config.oidcIssuer}/` }, { ...metadata, issuer: 'https://foreign.example' },
  ...['authorization_endpoint', 'token_endpoint'].flatMap((key) => [undefined, '/relative', 'http://auth.shocker.cl/token', 'https://foreign.example/token', 'https://user:secret@auth.shocker.cl/token', 'https://auth.shocker.cl/token#fragment'].map((value) => ({ ...metadata, [key]: value }))),
]) {
  test(`discovery rejects invalid metadata ${JSON.stringify(invalid)}`, async () => {
    await assert.rejects(discoverOidc(config, async () => Response.json(invalid)));
  });
}
test('discovery fails closed on HTTP, JSON and network errors', async () => {
  for (const request of [async () => new Response('', { status: 503 }), async () => new Response('invalid JSON'), async () => { throw new Error('network failure'); }]) {
    await assert.rejects(discoverOidc(config, request));
  }
});
test('discovery rejects non-loopback HTTP issuer before making requests', async () => {
  let requested = false;
  await assert.rejects(discoverOidc({ ...config, oidcIssuer: 'http://auth.example' }, async () => {
    requested = true;
    return Response.json(metadata);
  }));
  assert.equal(requested, false);
});

test('opt-in resource and scopes apply to authorization, code exchange and refresh', async () => {
  const candidate = { ...config, oidcResource: 'https://balance.example/api', oidcScopes: 'openid profile email offline_access' };
  const url = new URL(await buildAuthorizationUrl(candidate, transaction, metadata));
  assert.equal(url.searchParams.get('resource'), candidate.oidcResource);
  assert.equal(url.searchParams.get('scope'), candidate.oidcScopes);
  assert.equal(url.searchParams.has('prompt'), false);
  assert.equal(authorizationCodeBody(candidate, 'code', transaction).get('resource'), candidate.oidcResource);
  assert.equal(refreshTokenBody(candidate, 'refresh').get('resource'), candidate.oidcResource);
  assert.equal(refreshTokenBody(config, 'refresh').has('resource'), false);
});

test('revocation discovery rejects foreign and unsafe endpoints', async () => {
  for (const endpoint of [null, 'http://auth.shocker.cl/revoke', 'https://foreign.example/revoke', '/revoke']) {
    await assert.rejects(discoverOidc(config, async () => Response.json({ ...metadata, revocation_endpoint: endpoint })));
  }
});

test('refresh revocation posts only the refresh credential without browser cookies or redirects', async () => {
  await revokeRefreshToken(config, 'refresh-secret', Promise.resolve({ ...metadata, revocation_endpoint: 'https://auth.shocker.cl/revoke' }), async (url, options) => {
    assert.equal(url, 'https://auth.shocker.cl/revoke');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error');
    const body = options?.body as URLSearchParams;
    assert.deepEqual(Object.fromEntries(body), { client_id: config.oidcClientId, token: 'refresh-secret', token_type_hint: 'refresh_token' });
    return new Response(null, { status: 200 });
  });
});

test('revocation missing metadata, HTTP failure and timeout report failure', async () => {
  await assert.rejects(revokeRefreshToken(config, 'refresh', Promise.resolve(metadata)), /does not advertise/);
  await assert.rejects(revokeRefreshToken(config, 'refresh', Promise.resolve({ ...metadata, revocation_endpoint: 'https://auth.shocker.cl/revoke' }), async () => new Response(null, { status: 503 })), /503/);
  let requested = false;
  let resolve!: (value: typeof metadata) => void;
  const delayed = new Promise<typeof metadata>((done) => { resolve = done; });
  await assert.rejects(revokeRefreshToken(config, 'refresh', delayed, async () => { requested = true; return new Response(); }, 5), /timed out/);
  resolve(metadata);
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(requested, false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const issuedTokens = { access_token: 'issued-access', refresh_token: 'issued-refresh' };

test('logout during deferred exchange revokes the late refresh token without verification or adoption', async () => {
  let generation = 1;
  const exchanged = deferred<typeof issuedTokens>();
  const revoked: string[] = [];
  let verified = false;
  let adopted = false;
  const pending = new PendingOidcCredentials(async (token) => { revoked.push(token); });
  const operation = pending.exchangeAndVerify({
    exchange: () => exchanged.promise,
    verify: async () => { verified = true; return 'old-profile'; },
    adopt: () => { adopted = true; },
    current: () => generation === 1,
  });
  generation = 2; // The hook increments generation before local-first logout.
  await pending.revokePending();
  exchanged.resolve(issuedTokens);
  await operation;
  assert.deepEqual(revoked, ['issued-refresh']);
  assert.equal(verified, false);
  assert.equal(adopted, false);
});

test('logout during deferred profile verification immediately revokes pending credentials exactly once', async () => {
  let generation = 1;
  const profile = deferred<string>();
  const started = deferred<void>();
  const revoked: string[] = [];
  const pending = new PendingOidcCredentials(async (token) => { revoked.push(token); });
  let account = 'new-account';
  const operation = pending.exchangeAndVerify({
    exchange: async () => issuedTokens,
    verify: () => { started.resolve(); return profile.promise; },
    adopt: (_, value) => { account = value; },
    current: () => generation === 1,
  });
  await started.promise;
  generation = 2;
  await pending.revokePending();
  // Verification is still unresolved: revocation must already have happened.
  assert.deepEqual(revoked, ['issued-refresh']);
  profile.resolve('old-account');
  await operation;
  assert.deepEqual(revoked, ['issued-refresh']);
  assert.equal(account, 'new-account');
});

test('profile rejection revokes issued refresh credentials; successful adoption transfers their ownership', async () => {
  const revoked: string[] = [];
  const pending = new PendingOidcCredentials(async (token) => { revoked.push(token); });
  await assert.rejects(pending.exchangeAndVerify({
    exchange: async () => issuedTokens,
    verify: async () => { throw new Error('profile rejected'); },
    adopt: () => assert.fail('Rejected profile cannot be adopted'),
    current: () => true,
  }), /profile rejected/);
  assert.deepEqual(revoked, ['issued-refresh']);
  let account: string | null = null;
  await pending.exchangeAndVerify({
    exchange: async () => ({ access_token: 'next-access', refresh_token: 'next-refresh' }),
    verify: async () => 'verified-account',
    adopt: (_, profile) => { account = profile; },
    current: () => true,
  });
  await pending.revokePending();
  assert.equal(account, 'verified-account');
  assert.deepEqual(revoked, ['issued-refresh']);
});

test('pending callback revocation failure is exposed to logout and cannot cause adoption', async () => {
  let current = true;
  const profile = deferred<string>();
  const started = deferred<void>();
  let attempts = 0;
  const pending = new PendingOidcCredentials(async () => { attempts++; throw new Error('provider unavailable'); });
  const operation = pending.exchangeAndVerify({
    exchange: async () => issuedTokens,
    verify: () => { started.resolve(); return profile.promise; },
    adopt: () => assert.fail('Logged out callback cannot be adopted'),
    current: () => current,
  });
  await started.promise;
  current = false;
  await assert.rejects(pending.revokePending(), /provider unavailable/);
  profile.resolve('old-account');
  await assert.rejects(operation, /provider unavailable/);
  assert.equal(attempts, 1);
});
