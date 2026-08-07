/* Endpoints del backend. La IP estaba repetida en cuatro lugares. */

const DEFAULT_API_URL = 'https://balance.shocker.cl/api';
const DEFAULT_WS_URL = 'wss://balance.shocker.cl/api/ws/sync';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
export const WS_SYNC_URL = process.env.EXPO_PUBLIC_WS_URL ?? DEFAULT_WS_URL;

export const OIDC_ISSUER = process.env.EXPO_PUBLIC_OIDC_ISSUER ?? 'https://auth.shocker.cl/realms/balance';
export const OIDC_MOBILE_CLIENT_ID = process.env.EXPO_PUBLIC_OIDC_MOBILE_CLIENT_ID ?? 'balance-mobile';
