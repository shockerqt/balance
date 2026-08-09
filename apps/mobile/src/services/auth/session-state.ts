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
}

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

export const sessionForUnauthorizedResponse = (
  requestSession: StoredAuthSession,
  currentSession: StoredAuthSession | null,
) =>
  currentSession?.accessToken !== undefined &&
  currentSession.accessToken !== requestSession.accessToken
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
  refreshed: Omit<StoredAuthSession, "version" | "user">,
): StoredAuthSession => ({
  version: 2,
  ...refreshed,
  refreshToken: refreshed.refreshToken ?? previous.refreshToken,
  user: previous.user,
});
