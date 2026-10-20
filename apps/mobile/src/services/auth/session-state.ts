export interface SessionBinding {
  issuer: string;
  clientId: string;
  resource?: string;
  apiBaseUrl: string;
}

const isSessionBinding = (value: unknown): value is SessionBinding => {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<SessionBinding>;
  return [binding.issuer, binding.clientId, binding.apiBaseUrl].every(
    (field) => typeof field === "string" && field.length > 0,
  ) && (binding.resource === undefined ||
    typeof binding.resource === "string" && binding.resource.length > 0);
};

export const sameSessionBinding = (a: SessionBinding, b: SessionBinding) =>
  a.issuer === b.issuer && a.clientId === b.clientId &&
  a.resource === b.resource && a.apiBaseUrl === b.apiBaseUrl;

// The sole one-time unbound-session migration policy. It cannot follow env
// overrides to a new issuer, client, resource or backend.
const isLegacyProductionBinding = (binding: SessionBinding) =>
  binding.issuer === "https://auth.shocker.cl/realms/balance" &&
  binding.clientId === "balance-mobile" && binding.resource === undefined &&
  binding.apiBaseUrl === "https://balance.shocker.cl/api";

export const sessionForAuthContext = (
  session: StoredAuthSession | null,
  binding: SessionBinding,
): StoredAuthSession | null => {
  if (!session) return null;
  if (session.binding) return sameSessionBinding(session.binding, binding) ? session : null;
  return isLegacyProductionBinding(binding) ? { ...session, binding: { ...binding } } : null;
};

// Production retains its existing storage keys; every other API has its own
// opaque namespace even when user IDs coincide across databases.
export const authDataNamespace = (apiBaseUrl: string, userId: number): string =>
  apiBaseUrl === "https://balance.shocker.cl/api"
    ? `user:${userId}`
    : `user:${encodeURIComponent(apiBaseUrl)}:${userId}`;

// A transient refresh failure leaves the session retryable. The refresh owner
// handles terminal failure; an invalidated request must never retry or clear.
export const retryUnauthorizedRequest = async <T extends { status: number }>(
  original: T,
  refresh: () => Promise<StoredAuthSession | null>,
  isCurrent: () => boolean,
  request: (token: string) => Promise<T>,
  clear: () => Promise<unknown>,
): Promise<T> => {
  const refreshed = await refresh();
  if (!isCurrent() || !refreshed) return original;
  const response = await request(refreshed.accessToken);
  if (response.status === 401 && isCurrent()) await clear();
  return response;
};

export const oauthResourceParams = (resource?: string): Record<string, string> =>
  resource ? { resource } : {};

export const assertAuthorizationResponseIssuer = (
  issuer: string,
  responseIssuer: string | undefined,
  advertised: boolean,
) => {
  if ((advertised || responseIssuer !== undefined) && responseIssuer !== issuer)
    throw new Error("Authorization response issuer rejected");
};

export const STAGING_ANDROID_REDIRECT = "https://balance-staging.shocker.cl/auth-callback";

// A public opt-in for the reviewed Android development binary only.
export const chosenMobileRedirect = (
  binding: SessionBinding, scheme: string, platform: string, variant: unknown,
  configured?: string,
): string | undefined => {
  if (configured === undefined) return undefined;
  if (configured !== STAGING_ANDROID_REDIRECT || platform !== "android" ||
      variant !== "development" || scheme !== "balance-dev" ||
      binding.issuer !== "https://auth-staging.shocker.cl" ||
      binding.clientId !== "balance-mobile-staging" ||
      binding.apiBaseUrl !== "https://balance-staging.shocker.cl/api" ||
      binding.resource !== binding.apiBaseUrl)
    throw new Error("HTTPS redirect requires the reviewed Android staging context");
  return configured;
};

// Strict staging never accepts credentials delivered directly in a URL.
export const allowsLegacyCallbackToken = (issuer: string, clientId: string) =>
  issuer !== "https://auth-staging.shocker.cl" && clientId !== "balance-mobile-staging";

export const assertStagingMobileRedirect = (
  binding: SessionBinding,
  scheme: string,
  redirect: string,
  chosenRedirect?: string,
) => {
  if (chosenRedirect !== undefined && chosenRedirect !== STAGING_ANDROID_REDIRECT)
    throw new Error("Unregistered mobile redirect");
  if (binding.issuer === "https://auth-staging.shocker.cl" ||
      binding.clientId === "balance-mobile-staging") {
    if (binding.issuer !== "https://auth-staging.shocker.cl" ||
        binding.clientId !== "balance-mobile-staging" ||
        binding.apiBaseUrl !== "https://balance-staging.shocker.cl/api" ||
        (binding.resource !== undefined && binding.resource !== "https://balance-staging.shocker.cl/api") ||
        scheme !== "balance-dev" || redirect !== (chosenRedirect ?? "balance-dev://auth-callback"))
      throw new Error("Staging requires the registered Balance Dev redirect");
  }
};

// Do not let a late async result (or error) advance an invalidated login.
export const awaitCurrentAuthStep = async <T>(
  operation: Promise<T>,
  isCurrent: () => boolean,
): Promise<T | undefined> => {
  try {
    const value = await operation;
    return isCurrent() ? value : undefined;
  } catch (error) {
    if (isCurrent()) throw error;
    return undefined;
  }
};

export interface StoredUserProfile {
  id: number;
  email: string;
  name?: string;
  picture?: string;
}

export interface StoredAuthSession {
  version: 2;
  accessToken: string;
  refreshToken?: string;
  // Opaque original login token, native SecureStore only; solely an OP logout hint.
  idToken?: string;
  expiresIn?: number;
  issuedAt: number;
  scope?: string;
  user?: StoredUserProfile;
  // Identifies the credential chain a session belongs to. A refresh keeps it;
  // a different login (deep link, another account) gets a new one. That lets
  // an in-flight response tell a rotation apart from a replacement.
  lineage?: string;
  binding?: SessionBinding;
}

let lineageCounter = 0;

export const nextSessionLineage = () =>
  `${Date.now().toString(36)}.${(++lineageCounter).toString(36)}`;

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isStoredUser = (value: unknown): value is StoredUserProfile => {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<StoredUserProfile>;
  return (
    isPositiveNumber(user.id) &&
    Number.isInteger(user.id) &&
    typeof user.email === "string" &&
    user.email.length > 0 &&
    (user.name === undefined || typeof user.name === "string") &&
    (user.picture === undefined || typeof user.picture === "string")
  );
};

export const isLogoutIdToken = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 2048 && value.trim() === value;

export const parseStoredSession = (
  value: string | null,
): StoredAuthSession | null => {
  if (!value) return null;

  try {
    const candidate = JSON.parse(value) as Partial<StoredAuthSession>;
    if (
      candidate.version !== 2 ||
      typeof candidate.accessToken !== "string" ||
      candidate.accessToken.length === 0 ||
      !isPositiveNumber(candidate.issuedAt) ||
      (candidate.refreshToken !== undefined &&
        typeof candidate.refreshToken !== "string") ||
      (candidate.idToken !== undefined && !isLogoutIdToken(candidate.idToken)) ||
      (candidate.expiresIn !== undefined &&
        !isPositiveNumber(candidate.expiresIn)) ||
      (candidate.lineage !== undefined &&
        typeof candidate.lineage !== "string") ||
      (candidate.binding !== undefined && !isSessionBinding(candidate.binding)) ||
      !isStoredUser(candidate.user)
    ) {
      return null;
    }
    return candidate as StoredAuthSession;
  } catch {
    return null;
  }
};

export const isSessionFresh = (
  session: StoredAuthSession,
  nowSeconds = Math.floor(Date.now() / 1000),
  marginSeconds = 60,
) =>
  session.expiresIn === undefined ||
  nowSeconds < session.issuedAt + session.expiresIn - marginSeconds;

// A session with no lineage cannot be proven to be the same one, so it never
// matches: adopting the wrong session would mix one account's tokens with
// another account's identity.
export const isSameSessionLineage = (
  a: StoredAuthSession,
  b: StoredAuthSession,
) => a.lineage !== undefined && a.lineage === b.lineage &&
  (a.binding && b.binding ? sameSessionBinding(a.binding, b.binding) : !a.binding && !b.binding);

export const sessionForUnauthorizedResponse = (
  requestSession: StoredAuthSession,
  currentSession: StoredAuthSession | null,
) =>
  currentSession !== null &&
  isSameSessionLineage(requestSession, currentSession) &&
  currentSession.accessToken !== requestSession.accessToken
    ? currentSession
    : requestSession;

// The session a verified profile must be attached to: the newest one only when
// a concurrent refresh rotated the very credentials the request was made with.
export const sessionForVerifiedProfile = (
  requestSession: StoredAuthSession,
  currentSession: StoredAuthSession | null,
) =>
  currentSession !== null &&
  isSameSessionLineage(requestSession, currentSession)
    ? currentSession
    : requestSession;

export const refreshDelayMs = (
  session: StoredAuthSession,
  nowMs: number,
  retryAtMs?: number | null,
) => {
  if (retryAtMs !== undefined && retryAtMs !== null)
    return Math.max(1_000, retryAtMs - nowMs);
  if (session.expiresIn === undefined) return null;
  const refreshAtMs = (session.issuedAt + session.expiresIn - 60) * 1_000;
  return Math.max(1_000, refreshAtMs - nowMs);
};

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 300_000;

// Transient refresh failures (no network, unreachable discovery) back off
// instead of hammering the provider every five seconds while offline.
export const refreshRetryDelayMs = (attempt: number) =>
  Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));

export const accessTokenChanged = (
  currentToken: string | null,
  nextToken?: string,
) => Boolean(nextToken && currentToken && nextToken !== currentToken);

export class SerializedSessionWriter<T> {
  private queue: Promise<void> = Promise.resolve();
  private readonly write: (value: T | null) => Promise<void>;
  private readonly currentEpoch: () => number;
  private readonly onCommit: (value: T | null) => void;

  constructor(
    write: (value: T | null) => Promise<void>,
    currentEpoch: () => number,
    onCommit: (value: T | null) => void,
  ) {
    this.write = write;
    this.currentEpoch = currentEpoch;
    this.onCommit = onCommit;
  }

  commit(value: T | null, expectedEpoch: number): Promise<boolean> {
    const operation = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (expectedEpoch !== this.currentEpoch()) return false;
        await this.write(value);
        if (expectedEpoch !== this.currentEpoch()) return false;
        this.onCommit(value);
        return true;
      });
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

export const mergeRefreshedSession = (
  previous: StoredAuthSession,
  refreshed: Omit<StoredAuthSession, "version" | "user" | "lineage" | "binding">,
  web = false,
): StoredAuthSession => {
  // A provider returning another ID token cannot switch the original hint.
  const { idToken: _ignoredRefreshIdToken, ...credentials } = refreshed;
  return {
    version: 2,
    ...credentials,
    refreshToken: web ? undefined : refreshed.refreshToken ?? previous.refreshToken,
    // Refresh cannot replace the original login/session hint.
    ...(web || previous.idToken === undefined ? {} : { idToken: previous.idToken }),
    user: previous.user,
    lineage: previous.lineage,
    ...(previous.binding ? { binding: previous.binding } : {}),
  };
};

// SecureStore only accepts alphanumeric keys plus `.`, `-` and `_`.
export const SESSION_KEY = "balance.auth.session.v2";
export const LEGACY_TOKEN_KEY = "balance.auth.token.v1";
export const LEGACY_WEB_TOKEN_KEY = "@balance_auth_token_v1";
export const LOGGED_OUT_MARKER = '{"version":2,"loggedOut":true}';

export interface SessionWrite {
  key: string;
  value: string | null;
}

// The whole session lives in one record, so a write either lands or does not:
// there is no window where a rotated refresh token belongs to one generation
// and the access token to another. The record is also written first, and every
// later step only removes copies `resolveStoredSession` already ignores, so an
// interrupted plan can neither resurrect a closed session nor split an open
// one. Applied in order, and never in parallel.
export const sessionWritePlan = (
  session: StoredAuthSession | null,
  web: boolean,
): SessionWrite[] => {
  const writes: SessionWrite[] = [
    {
      key: SESSION_KEY,
      // Browser storage is readable by page JavaScript, so refresh credentials
      // never reach it. The marker stops a partially failed logout from
      // falling back to a surviving v1 token; a later login replaces it.
      value: session
        ? JSON.stringify(
            web ? { ...session, refreshToken: undefined, idToken: undefined } : session,
          )
        : LOGGED_OUT_MARKER,
    },
    { key: LEGACY_TOKEN_KEY, value: null },
  ];
  if (web) writes.push({ key: LEGACY_WEB_TOKEN_KEY, value: null });
  return writes;
};

export const resolveStoredSession = (
  record: string | null,
  legacyToken: string | null,
  web: boolean,
  nowSeconds = Math.floor(Date.now() / 1000),
): StoredAuthSession | null => {
  if (record === LOGGED_OUT_MARKER) return null;

  // A corrupt deciding record must never fall back to an older unbound token.
  if (record) {
    try {
      const value = JSON.parse(record);
      if (value?.binding !== undefined && !isSessionBinding(value.binding)) return null;
      if (value?.idToken !== undefined && !isLogoutIdToken(value.idToken)) return null;
    } catch { return null; }
  }
  const saved = parseStoredSession(record);
  if (saved)
    return {
      ...saved,
      refreshToken: web ? undefined : saved.refreshToken,
      idToken: web ? undefined : saved.idToken,
      lineage: saved.lineage ?? nextSessionLineage(),
    };

  // BAL-011 persisted only the access token. Keep it for a one-time migration;
  // the API will validate it, but it cannot be refreshed after expiration.
  return legacyToken
    ? {
        version: 2,
        accessToken: legacyToken,
        issuedAt: nowSeconds,
        lineage: nextSessionLineage(),
      }
    : null;
};


export const assertSyncConfiguration = (
  api: string, ws: string, mode: string, issuer: string, client: string,
) => {
  if (mode !== "legacy" && mode !== "application") throw new Error("Invalid sync authentication mode");
  if (issuer === "https://auth-staging.shocker.cl" || client === "balance-mobile-staging" || api === "https://balance-staging.shocker.cl/api") {
    if (api !== "https://balance-staging.shocker.cl/api" ||
        ws !== "wss://balance-staging.shocker.cl/api/ws/sync/application" || mode !== "application")
      throw new Error("Staging requires its application-authenticated sync endpoint");
  }
};


export type BrowserLogoutStatus = "confirmed" | "unconfirmed" | "not_requested" | "in_progress";

export const browserLogoutRequest = (
  binding: SessionBinding, endpoint: string, scheme: string, platform: string,
  redirect: string, state: string, idToken?: string,
): string => {
  if (endpoint !== "https://auth-staging.shocker.cl/logout" ||
      binding.issuer !== "https://auth-staging.shocker.cl" ||
      binding.clientId !== "balance-mobile-staging" ||
      binding.apiBaseUrl !== "https://balance-staging.shocker.cl/api" ||
      (binding.resource !== undefined && binding.resource !== binding.apiBaseUrl) ||
      !["android", "ios"].includes(platform) || scheme !== "balance-dev" ||
      redirect !== "balance-dev://logout-callback" || !/^[a-f0-9]{64}$/.test(state))
    throw new Error("Browser logout requires the reviewed native staging context");
  const url = new URL(endpoint);
  url.searchParams.set("client_id", binding.clientId);
  url.searchParams.set("post_logout_redirect_uri", redirect);
  url.searchParams.set("state", state);
  if (idToken !== undefined) {
    if (!isLogoutIdToken(idToken)) throw new Error("Invalid logout hint");
    url.searchParams.set("id_token_hint", idToken);
  }
  return url.toString();
};

export const isValidLogoutReturn = (value: string, redirect: string, state: string): boolean => {
  try {
    if (/[\u0000-\u0020\u007f]/.test(value) || value.includes("#") || value.split("?")[0] !== redirect) return false;
    const url = new URL(value);
    return !url.username && !url.password &&
      url.searchParams.getAll("state").length === 1 &&
      url.searchParams.get("state") === state &&
      [...url.searchParams.keys()].every(key => key === "state");
  } catch { return false; }
};

// Display metadata only: it never grants or restores an authenticated session.
export interface RememberedAccount {
  version: 1;
  binding: SessionBinding;
  user: StoredUserProfile;
}
export const REMEMBERED_ACCOUNT_KEY = "balance.auth.remembered.v1";
const isRememberableProfile = (user: unknown): user is StoredUserProfile =>
  !!user && isStoredUser(user) && Number.isSafeInteger((user as StoredUserProfile).id) &&
  (user as StoredUserProfile).id > 0 && (user as StoredUserProfile).email.trim().length > 0 &&
  (user as StoredUserProfile).email.length <= 320 &&
  ((user as StoredUserProfile).name === undefined || (user as StoredUserProfile).name!.length <= 200);
export const rememberedAccountForProfile = (user: StoredUserProfile, binding: SessionBinding): RememberedAccount => {
  if (!isRememberableProfile(user)) throw new Error("Invalid remembered profile");
  return {
    version: 1, binding: { ...binding },
    user: { id: user.id, email: user.email, ...(user.name === undefined ? {} : { name: user.name }) },
  };
};
export const parseRememberedAccount = (raw: string | null, binding: SessionBinding): RememberedAccount | null => {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.version !== 1 || !isSessionBinding(value.binding) ||
        !sameSessionBinding(value.binding, binding) || !isRememberableProfile(value.user)) return null;
    // Reconstruct the allowlisted metadata so unknown fields cannot carry credentials.
    return rememberedAccountForProfile(value.user, binding);
  } catch { return null; }
};
export const accountChoicesBindingAllowed = (
  enabled: boolean, development: boolean, platform: string, scheme: unknown,
  variant: unknown, binding: SessionBinding,
) => enabled && development && ['android', 'ios'].includes(platform) &&
  scheme === 'balance-dev' && variant === 'development' &&
  binding.issuer === 'https://auth-staging.shocker.cl' &&
  binding.clientId === 'balance-mobile-staging' &&
  binding.resource === 'https://balance-staging.shocker.cl/api' &&
  binding.apiBaseUrl === binding.resource;
export const assertRememberedIdentity = (user: StoredUserProfile, remembered: RememberedAccount | null) => {
  if (!isRememberableProfile(user)) throw new Error("Invalid verified profile");
  if (remembered && user.id !== remembered.user.id)
    throw new Error('Usa otra cuenta para elegir la cuenta que quieres abrir.');
};
