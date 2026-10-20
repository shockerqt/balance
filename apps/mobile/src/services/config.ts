import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { assertSyncConfiguration } from "./auth/session-state";
/* Endpoints del backend. La IP estaba repetida en cuatro lugares. */

const DEFAULT_API_URL = 'https://balance.shocker.cl/api';
const LEGACY_WS_URL = 'wss://balance.shocker.cl/api/ws/sync';
const variant = Constants.expoConfig?.extra?.appVariant;
// The reviewed Android binaries supply appVariant even when an OTA has no public overrides.
// An explicitly different issuer/API retains its isolated environment selection.
const productionAndroid = Platform.OS === 'android' &&
  (variant === 'development' || variant === 'daily') &&
  (process.env.EXPO_PUBLIC_OIDC_ISSUER === undefined || process.env.EXPO_PUBLIC_OIDC_ISSUER === 'https://auth.shocker.cl') &&
  (process.env.EXPO_PUBLIC_API_URL === undefined || process.env.EXPO_PUBLIC_API_URL === DEFAULT_API_URL);
const DEFAULT_WS_URL = productionAndroid ? `${LEGACY_WS_URL}/application` : LEGACY_WS_URL;

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
export const WS_SYNC_URL = process.env.EXPO_PUBLIC_WS_URL ?? DEFAULT_WS_URL;

export const OIDC_ISSUER = process.env.EXPO_PUBLIC_OIDC_ISSUER ?? (productionAndroid ? 'https://auth.shocker.cl' : 'https://auth.shocker.cl/realms/balance');
export const OIDC_MOBILE_CLIENT_ID = process.env.EXPO_PUBLIC_OIDC_MOBILE_CLIENT_ID ?? (productionAndroid ? (variant === 'development' ? 'balance-mobile-dev' : 'balance-mobile-daily') : 'balance-mobile');

// Explicit public overrides remain authoritative for isolated staging and fixtures.
export const OIDC_RESOURCE = process.env.EXPO_PUBLIC_OIDC_RESOURCE !== undefined
  ? process.env.EXPO_PUBLIC_OIDC_RESOURCE.trim() || undefined
  : productionAndroid ? DEFAULT_API_URL : undefined;
export const OIDC_SCOPES: string[] = process.env.EXPO_PUBLIC_OIDC_SCOPES
  ? [...new Set<string>(process.env.EXPO_PUBLIC_OIDC_SCOPES.trim().split(/\s+/).filter(Boolean))]
  : productionAndroid ? ['openid', 'profile', 'email', 'offline_access'] : ['openid', 'profile', 'email'];

export const WS_AUTH_MODE = process.env.EXPO_PUBLIC_WS_AUTH_MODE ?? (productionAndroid ? 'application' : 'legacy');
assertSyncConfiguration(API_BASE_URL, WS_SYNC_URL, WS_AUTH_MODE, OIDC_ISSUER, OIDC_MOBILE_CLIENT_ID);

// Reviewed provider-local browser logout, opt-in and native staging only.
// Enable only after the reviewed provider supports session-bound logout hints.
export const OIDC_LOGOUT_ID_TOKEN_HINT = process.env.EXPO_PUBLIC_OIDC_LOGOUT_ID_TOKEN_HINT === '1';
export const OIDC_BROWSER_LOGOUT_URL = process.env.EXPO_PUBLIC_OIDC_BROWSER_LOGOUT_URL;

export const OIDC_REDIRECT_URI = process.env.EXPO_PUBLIC_OIDC_REDIRECT_URI ?? (productionAndroid
  ? `https://balance.shocker.cl/auth-callback/${variant === 'development' ? 'dev' : 'daily'}`
  : undefined);

// Production defaults apply only to the reviewed Android Dev/Daily binaries.
export const OIDC_ACCOUNT_CHOICES = process.env.EXPO_PUBLIC_OIDC_ACCOUNT_CHOICES !== undefined
  ? process.env.EXPO_PUBLIC_OIDC_ACCOUNT_CHOICES === '1'
  : productionAndroid;
