const DEFAULT_API_URL = 'https://balance.shocker.cl/api';
const DEFAULT_WS_URL = 'wss://balance.shocker.cl/api/ws/sync';
const DEFAULT_OIDC_ISSUER = 'https://auth.shocker.cl';
const DEFAULT_OIDC_CLIENT_ID = 'balance-dashboard';

export interface DashboardServiceConfig {
  apiBaseUrl: string;
  wsSyncUrl: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcRedirectUri: string;
  oidcResource?: string;
  oidcScopes?: string;
  wsAuthMode?: 'legacy' | 'application';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function validateDashboardServiceConfig(config: DashboardServiceConfig): DashboardServiceConfig {
  if (config.oidcResource !== undefined) {
    const resource = new URL(config.oidcResource);
    if (config.oidcResource !== config.oidcResource.trim() || resource.protocol !== 'https:' || resource.username || resource.password || resource.hash || resource.search) {
      throw new Error('Invalid OIDC resource');
    }
  }
  if (config.oidcScopes !== undefined &&
      (!config.oidcScopes.split(' ').includes('openid') || !/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(config.oidcScopes))) {
    throw new Error('Invalid OIDC scopes');
  }
  if (config.wsAuthMode !== undefined && !['legacy', 'application'].includes(config.wsAuthMode)) {
    throw new Error('Invalid WebSocket authentication mode');
  }
  if (config.wsAuthMode === 'application') {
    const socket = new URL(config.wsSyncUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(socket.hostname);
    if ((socket.protocol !== 'wss:' && !(socket.protocol === 'ws:' && loopback)) || socket.username || socket.password || socket.hash) {
      throw new Error('Application WebSocket authentication requires a secure endpoint');
    }
  }
  return config;
}

export function getDashboardServiceConfig(
  origin = window.location.origin,
  environment: Record<string, string | undefined> = import.meta.env ?? {},
): DashboardServiceConfig {
  const issuer = trimTrailingSlash(environment.VITE_OIDC_ISSUER ?? DEFAULT_OIDC_ISSUER);
  // Explicit legacy/staging issuers must never inherit a production resource or transport.
  const production = issuer === DEFAULT_OIDC_ISSUER &&
    (environment.VITE_API_URL === undefined || trimTrailingSlash(environment.VITE_API_URL) === DEFAULT_API_URL);
  return validateDashboardServiceConfig({
    apiBaseUrl: trimTrailingSlash(environment.VITE_API_URL ?? DEFAULT_API_URL),
    wsSyncUrl: environment.VITE_WS_URL ?? `${DEFAULT_WS_URL}${production ? '/application' : ''}`,
    oidcIssuer: issuer,
    oidcClientId: environment.VITE_OIDC_CLIENT_ID ?? (production ? DEFAULT_OIDC_CLIENT_ID : 'balance-mobile'),
    oidcResource: environment.VITE_OIDC_RESOURCE ?? (production ? DEFAULT_API_URL : undefined),
    oidcScopes: environment.VITE_OIDC_SCOPES ?? (production ? 'openid profile email offline_access' : undefined),
    wsAuthMode: (environment.VITE_WS_AUTH_MODE ?? (production ? 'application' : 'legacy')) as DashboardServiceConfig['wsAuthMode'],
    oidcRedirectUri: environment.VITE_OIDC_REDIRECT_URI ?? `${trimTrailingSlash(origin)}/`,
  });
}
