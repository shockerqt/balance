const DEFAULT_API_URL = 'https://balance.shocker.cl/api';
const DEFAULT_WS_URL = 'wss://balance.shocker.cl/api/ws/sync';
const DEFAULT_OIDC_ISSUER = 'https://auth.shocker.cl/realms/balance';
const DEFAULT_OIDC_CLIENT_ID = 'balance-mobile';

export interface DashboardServiceConfig {
  apiBaseUrl: string;
  wsSyncUrl: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcRedirectUri: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getDashboardServiceConfig(origin = window.location.origin): DashboardServiceConfig {
  return {
    apiBaseUrl: trimTrailingSlash(import.meta.env.VITE_API_URL ?? DEFAULT_API_URL),
    wsSyncUrl: import.meta.env.VITE_WS_URL ?? DEFAULT_WS_URL,
    oidcIssuer: trimTrailingSlash(import.meta.env.VITE_OIDC_ISSUER ?? DEFAULT_OIDC_ISSUER),
    oidcClientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? DEFAULT_OIDC_CLIENT_ID,
    oidcRedirectUri: import.meta.env.VITE_OIDC_REDIRECT_URI ?? `${trimTrailingSlash(origin)}/`,
  };
}
