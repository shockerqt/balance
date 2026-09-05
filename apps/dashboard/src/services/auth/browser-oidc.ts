import type { DashboardServiceConfig } from '../config.ts';

export const OIDC_TRANSACTION_KEY = 'balance.dashboard.oidc-transaction.v1';
export const OIDC_SSO_MARKER_KEY = 'balance.dashboard.oidc-sso.v1';
export const OIDC_TRANSACTION_MAX_AGE_MS = 10 * 60 * 1000;

export type OidcPrompt = 'login' | 'none';

export interface OidcTransaction {
  version: 1;
  state: string;
  verifier: string;
  redirectUri: string;
  returnTo: string;
  prompt: OidcPrompt;
  createdAt: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  token_type?: string;
  scope?: string;
}

export type OidcCallbackResult =
  | { type: 'none' }
  | { type: 'error'; error: string; description: string | null; transaction: OidcTransaction | null }
  | { type: 'invalid'; reason: string }
  | { type: 'code'; code: string; transaction: OidcTransaction };

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomUrlSafe(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function createOidcTransaction(
  redirectUri: string,
  returnTo: string,
  prompt: OidcPrompt,
  now = Date.now(),
): OidcTransaction {
  return {
    version: 1,
    state: randomUrlSafe(24),
    verifier: randomUrlSafe(48),
    redirectUri,
    returnTo,
    prompt,
    createdAt: now,
  };
}

export function isOidcTransaction(value: unknown): value is OidcTransaction {
  if (!value || typeof value !== 'object') return false;
  const transaction = value as Record<string, unknown>;
  return (
    transaction.version === 1 &&
    typeof transaction.state === 'string' && transaction.state.length >= 16 &&
    typeof transaction.verifier === 'string' && transaction.verifier.length >= 43 &&
    typeof transaction.redirectUri === 'string' && transaction.redirectUri.length > 0 &&
    typeof transaction.returnTo === 'string' && transaction.returnTo.startsWith('/') &&
    (transaction.prompt === 'login' || transaction.prompt === 'none') &&
    typeof transaction.createdAt === 'number' && Number.isFinite(transaction.createdAt)
  );
}

export function parseStoredTransaction(raw: string | null): OidcTransaction | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isOidcTransaction(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseOidcCallback(
  search: string,
  transaction: OidcTransaction | null,
  now = Date.now(),
): OidcCallbackResult {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return { type: 'none' };

  if (!transaction) return { type: 'invalid', reason: 'missing transaction' };
  if (now - transaction.createdAt > OIDC_TRANSACTION_MAX_AGE_MS) {
    return { type: 'invalid', reason: 'expired transaction' };
  }
  if (params.get('state') !== transaction.state) {
    return { type: 'invalid', reason: 'state mismatch' };
  }
  if (error) {
    return {
      type: 'error',
      error,
      description: params.get('error_description'),
      transaction,
    };
  }
  if (!code) return { type: 'invalid', reason: 'missing authorization code' };
  return { type: 'code', code, transaction };
}

export async function buildAuthorizationUrl(
  config: DashboardServiceConfig,
  transaction: OidcTransaction,
): Promise<string> {
  const challenge = await pkceChallenge(transaction.verifier);
  const url = new URL(`${config.oidcIssuer}/protocol/openid-connect/auth`);
  url.searchParams.set('client_id', config.oidcClientId);
  url.searchParams.set('redirect_uri', transaction.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', transaction.state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (transaction.prompt === 'none') url.searchParams.set('prompt', 'none');
  return url.toString();
}

export function authorizationCodeBody(
  config: DashboardServiceConfig,
  code: string,
  transaction: OidcTransaction,
): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.oidcClientId,
    code,
    redirect_uri: transaction.redirectUri,
    code_verifier: transaction.verifier,
  });
}

export function refreshTokenBody(config: DashboardServiceConfig, refreshToken: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.oidcClientId,
    refresh_token: refreshToken,
  });
}

export function tokenEndpoint(config: DashboardServiceConfig): string {
  return `${config.oidcIssuer}/protocol/openid-connect/token`;
}

export function sanitizedReturnTo(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
