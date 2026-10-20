import { assertSyncConfiguration } from "./auth/session-state";
/* Endpoints del backend. La IP estaba repetida en cuatro lugares. */

const DEFAULT_API_URL = 'https://balance.shocker.cl/api';
const DEFAULT_WS_URL = 'wss://balance.shocker.cl/api/ws/sync';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
export const WS_SYNC_URL = process.env.EXPO_PUBLIC_WS_URL ?? DEFAULT_WS_URL;

export const OIDC_ISSUER = process.env.EXPO_PUBLIC_OIDC_ISSUER ?? 'https://auth.shocker.cl/realms/balance';
export const OIDC_MOBILE_CLIENT_ID = process.env.EXPO_PUBLIC_OIDC_MOBILE_CLIENT_ID ?? 'balance-mobile';

// Public, opt-in OIDC request configuration; existing production defaults stay.
export const OIDC_RESOURCE = process.env.EXPO_PUBLIC_OIDC_RESOURCE?.trim() || undefined;
export const OIDC_SCOPES: string[] = process.env.EXPO_PUBLIC_OIDC_SCOPES
  ? [...new Set<string>(process.env.EXPO_PUBLIC_OIDC_SCOPES.trim().split(/\s+/).filter(Boolean))]
  : ['openid', 'profile', 'email'];

export const WS_AUTH_MODE = process.env.EXPO_PUBLIC_WS_AUTH_MODE ?? 'legacy';
assertSyncConfiguration(API_BASE_URL, WS_SYNC_URL, WS_AUTH_MODE, OIDC_ISSUER, OIDC_MOBILE_CLIENT_ID);

// Reviewed provider-local browser logout, opt-in and native staging only.
// Enable only after the reviewed provider supports session-bound logout hints.
export const OIDC_LOGOUT_ID_TOKEN_HINT = process.env.EXPO_PUBLIC_OIDC_LOGOUT_ID_TOKEN_HINT === '1';
export const OIDC_BROWSER_LOGOUT_URL = process.env.EXPO_PUBLIC_OIDC_BROWSER_LOGOUT_URL;

export const OIDC_REDIRECT_URI = process.env.EXPO_PUBLIC_OIDC_REDIRECT_URI;
