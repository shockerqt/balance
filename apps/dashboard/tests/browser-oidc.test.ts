import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OIDC_TRANSACTION_MAX_AGE_MS,
  authorizationCodeBody,
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
