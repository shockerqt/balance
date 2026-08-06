/* Endpoints del backend. La IP estaba repetida en cuatro lugares. */

const DEFAULT_HOST = '144.22.47.0:8080';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${DEFAULT_HOST}`;

export const WS_SYNC_URL = process.env.EXPO_PUBLIC_WS_URL ?? `ws://${DEFAULT_HOST}/ws/sync`;
