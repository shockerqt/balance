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
  expiresIn?: number;
  issuedAt: number;
  scope?: string;
  user?: StoredUserProfile;
  // Identifies the credential chain a session belongs to. A refresh keeps it;
  // a different login (deep link, another account) gets a new one. That lets
  // an in-flight response tell a rotation apart from a replacement.
  lineage?: string;
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
      (candidate.expiresIn !== undefined &&
        !isPositiveNumber(candidate.expiresIn)) ||
      (candidate.lineage !== undefined &&
        typeof candidate.lineage !== "string") ||
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
) => a.lineage !== undefined && a.lineage === b.lineage;

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
  refreshed: Omit<StoredAuthSession, "version" | "user" | "lineage">,
): StoredAuthSession => ({
  version: 2,
  ...refreshed,
  refreshToken: refreshed.refreshToken ?? previous.refreshToken,
  user: previous.user,
  lineage: previous.lineage,
});

// expo-secure-store rejects values past 2048 bytes on Android.
export const SECURE_STORE_VALUE_LIMIT = 2_048;

const utf8Length = (value: string) => {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

// The refresh token is stored under its own key, so only the access token
// weighs on this record. `user` and `scope` are caches the client rebuilds
// from `/me`, so they are what gets dropped if the record is still too large;
// the tokens themselves are never sacrificed.
export const serializeSessionRecord = (
  session: StoredAuthSession,
  limit = SECURE_STORE_VALUE_LIMIT,
): string => {
  const { refreshToken: _refreshToken, ...record } = session;
  const candidates = [
    record,
    { ...record, user: undefined },
    { ...record, user: undefined, scope: undefined },
  ];
  for (const candidate of candidates) {
    const serialized = JSON.stringify(candidate);
    if (utf8Length(serialized) <= limit) return serialized;
  }
  return JSON.stringify(candidates[candidates.length - 1]);
};
