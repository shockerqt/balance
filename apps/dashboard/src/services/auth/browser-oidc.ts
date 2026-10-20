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

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
}

function trustedOidcUrl(value: string, issuer?: URL): URL {
  const url = new URL(value);
  // Local HTTP is retained exclusively for the existing loopback E2E provider.
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.hash ||
      (issuer && url.origin !== issuer.origin)) {
    throw new Error('Untrusted OIDC URL');
  }
  return url;
}

export async function discoverOidc(
  config: DashboardServiceConfig,
  request: typeof fetch = fetch,
): Promise<OidcDiscovery> {
  const issuer = trustedOidcUrl(config.oidcIssuer);
  if (issuer.search) throw new Error('Invalid OIDC issuer');
  const response = await request(`${config.oidcIssuer}/.well-known/openid-configuration`, {
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
  const metadata: unknown = await response.json();
  if (!metadata || typeof metadata !== 'object') throw new Error('Invalid OIDC discovery');
  const document = metadata as Record<string, unknown>;
  if (document.issuer !== config.oidcIssuer) throw new Error('OIDC discovery issuer mismatch');
  for (const name of ['authorization_endpoint', 'token_endpoint'] as const) {
    if (typeof document[name] !== 'string') throw new Error(`Missing OIDC ${name}`);
    trustedOidcUrl(document[name], issuer);
  }
  if (document.revocation_endpoint !== undefined) {
    if (typeof document.revocation_endpoint !== 'string') throw new Error('Invalid OIDC revocation_endpoint');
    trustedOidcUrl(document.revocation_endpoint, issuer);
  }
  return {
    ...(typeof document.revocation_endpoint === 'string' ? { revocation_endpoint: document.revocation_endpoint } : {}),
    issuer: config.oidcIssuer,
    authorization_endpoint: document.authorization_endpoint as string,
    token_endpoint: document.token_endpoint as string,
  };
}

export async function buildAuthorizationUrl(
  config: DashboardServiceConfig,
  transaction: OidcTransaction,
  discovery: OidcDiscovery,
): Promise<string> {
  const challenge = await pkceChallenge(transaction.verifier);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('client_id', config.oidcClientId);
  url.searchParams.set('redirect_uri', transaction.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.oidcScopes ?? 'openid profile email');
  if (config.oidcResource) url.searchParams.set('resource', config.oidcResource);
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
    ...(config.oidcResource ? { resource: config.oidcResource } : {}),
    grant_type: 'authorization_code',
    client_id: config.oidcClientId,
    code,
    redirect_uri: transaction.redirectUri,
    code_verifier: transaction.verifier,
  });
}

export function refreshTokenBody(config: DashboardServiceConfig, refreshToken: string): URLSearchParams {
  return new URLSearchParams({
    ...(config.oidcResource ? { resource: config.oidcResource } : {}),
    grant_type: 'refresh_token',
    client_id: config.oidcClientId,
    refresh_token: refreshToken,
  });
}

export function sanitizedReturnTo(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

// Refresh revocation does not navigate or clear the provider's browser SSO session.
export async function revokeRefreshToken(
  config: DashboardServiceConfig,
  refreshToken: string,
  discovery: Promise<OidcDiscovery>,
  request: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Provider refresh-token revocation timed out; local session is cleared'));
    }, timeoutMs);
  });
  try {
    await Promise.race([timeout, (async () => {
      const metadata = await discovery;
      if (controller.signal.aborted) return;
      if (!metadata.revocation_endpoint) throw new Error('Provider does not advertise refresh-token revocation; local session is cleared');
      const response = await request(metadata.revocation_endpoint, {
        method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.oidcClientId, token: refreshToken, token_type_hint: 'refresh_token' }),
      });
      if (!response.ok) throw new Error(`Provider refresh-token revocation failed (${response.status}); local session is cleared`);
    })()]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Owns issued callback credentials only until verified session adoption or cleanup. */
export class PendingOidcCredentials {
  private pending = new Set<{ revoke: () => Promise<void> }>();
  private readonly revokeToken: (refreshToken: string) => Promise<void>;

  constructor(revokeToken: (refreshToken: string) => Promise<void>) {
    this.revokeToken = revokeToken;
  }

  async exchangeAndVerify<Profile>(options: {
    exchange: () => Promise<TokenResponse>;
    verify: (tokens: TokenResponse) => Promise<Profile>;
    adopt: (tokens: TokenResponse, profile: Profile) => void;
    current: () => boolean;
  }): Promise<void> {
    const tokens = await options.exchange();
    let cleanup: Promise<void> | null = null;
    const issued = {
      revoke: () => {
        if (!cleanup) cleanup = tokens.refresh_token ? this.revokeToken(tokens.refresh_token) : Promise.resolve();
        return cleanup;
      },
    };
    this.pending.add(issued);
    let adopted = false;
    try {
      if (!options.current()) return;
      const profile = await options.verify(tokens);
      if (!options.current()) return;
      options.adopt(tokens, profile);
      adopted = true;
    } finally {
      try {
        if (!adopted) await issued.revoke();
      } finally {
        this.pending.delete(issued);
      }
    }
  }

  async revokePending(): Promise<void> {
    const results = await Promise.allSettled(Array.from(this.pending, (issued) => issued.revoke()));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}
