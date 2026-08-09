import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { syncClient } from '@/services/sync/sync-client';
import { fetchOfficialTemplates } from '@/services/sync/official-templates';
import { API_BASE_URL, OIDC_ISSUER, OIDC_MOBILE_CLIENT_ID } from '@/services/config';
import { storage } from '@/services/storage';
import {
  refreshDelayMs,
  refreshRetryDelayMs,
  isSessionFresh,
  mergeRefreshedSession,
  nextSessionLineage,
  parseStoredSession,
  serializeSessionRecord,
  SerializedSessionWriter,
  sessionForUnauthorizedResponse,
  sessionForVerifiedProfile,
  StoredAuthSession,
  StoredUserProfile,
} from '@/services/auth/session-state';

WebBrowser.maybeCompleteAuthSession();

export type UserProfile = StoredUserProfile;

interface ApiResponse<T> {
  data?: T | null;
}

// SecureStore only accepts alphanumeric keys plus `.`, `-` and `_`.
const SESSION_KEY = 'balance.auth.session.v2';
const REFRESH_KEY = 'balance.auth.refresh.v2';
const LEGACY_TOKEN_KEY = 'balance.auth.token.v1';
const LEGACY_WEB_TOKEN_KEY = '@balance_auth_token_v1';
const GUEST_KEY = '@balance_guest_v1';
const AUTH_SCOPES = ['openid', 'profile', 'email'];
const LOGGED_OUT_MARKER = '{"version":2,"loggedOut":true}';

const readValue = (key: string) => (Platform.OS === 'web' ? storage.getItem(key) : SecureStore.getItemAsync(key));

const writeValue = async (key: string, value: string | null) => {
  if (Platform.OS === 'web') {
    if (value) await storage.setItem(key, value);
    else await storage.removeItem(key);
    return;
  }
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
};

const readSession = async (): Promise<StoredAuthSession | null> => {
  const rawSession = await readValue(SESSION_KEY);
  if (rawSession === LOGGED_OUT_MARKER) return null;
  const saved = parseStoredSession(rawSession);
  if (saved) {
    // Browser storage is readable by page JavaScript and never holds refresh
    // credentials. `saved.refreshToken` covers records written inline before
    // the credential moved to its own key.
    const refreshToken =
      Platform.OS === 'web' ? undefined : (saved.refreshToken ?? (await readValue(REFRESH_KEY)) ?? undefined);
    return { ...saved, refreshToken, lineage: saved.lineage ?? nextSessionLineage() };
  }

  // BAL-011 persisted only the access token. Keep it for a one-time migration;
  // the API will validate it, but it cannot be refreshed after expiration.
  const legacyToken =
    (await readValue(LEGACY_TOKEN_KEY)) ?? (Platform.OS === 'web' ? await storage.getItem(LEGACY_WEB_TOKEN_KEY) : null);
  return legacyToken
    ? {
        version: 2,
        accessToken: legacyToken,
        issuedAt: Math.floor(Date.now() / 1000),
        lineage: nextSessionLineage(),
      }
    : null;
};

const writeSession = async (session: StoredAuthSession | null) => {
  // Android SecureStore rejects values past 2 KB and two JWTs in one record can
  // cross it, so the refresh token gets its own entry: written before the
  // record that references it, and cleared first on logout.
  await writeValue(REFRESH_KEY, session?.refreshToken ?? null);
  // The marker prevents a partially failed logout from falling back to a
  // surviving v1 token. A later login replaces it with a valid v2 session.
  await writeValue(SESSION_KEY, session ? serializeSessionRecord(session) : LOGGED_OUT_MARKER);
  await writeValue(LEGACY_TOKEN_KEY, null);
  if (Platform.OS === 'web') await storage.removeItem(LEGACY_WEB_TOKEN_KEY);
};

const fromTokenResponse = (response: AuthSession.TokenResponse, previous?: StoredAuthSession): StoredAuthSession =>
  mergeRefreshedSession(
    previous ?? {
      version: 2,
      accessToken: response.accessToken,
      issuedAt: response.issuedAt,
      lineage: nextSessionLineage(),
    },
    {
      accessToken: response.accessToken,
      // Browser storage is readable by page JavaScript. The mobile task keeps
      // refresh credentials only in native SecureStore.
      refreshToken: Platform.OS === 'web' ? undefined : response.refreshToken,
      expiresIn: response.expiresIn,
      issuedAt: response.issuedAt,
      scope: response.scope,
    },
  );

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  isLoading: boolean;
  loginWithGoogle: () => Promise<void>;
  enableGuestMode: () => Promise<void>;
  logout: () => Promise<void>;
  setAuthToken: (token: string | null) => void;
  checkSession: (tokenOverride?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [refreshRetryAt, setRefreshRetryAt] = useState<number | null>(null);
  const sessionRef = useRef<StoredAuthSession | null>(null);
  const epochRef = useRef(0);
  const refreshAttemptRef = useRef(0);
  const sessionWriterRef = useRef<SerializedSessionWriter<StoredAuthSession> | null>(null);
  const refreshRef = useRef<{
    epoch: number;
    promise: Promise<StoredAuthSession | null>;
  } | null>(null);

  if (!sessionWriterRef.current) {
    sessionWriterRef.current = new SerializedSessionWriter(
      writeSession,
      () => epochRef.current,
      (session) => {
        sessionRef.current = session;
        setSessionRevision((revision) => revision + 1);
      },
    );
  }

  const commitSession = useCallback(
    (session: StoredAuthSession | null, expectedEpoch: number) =>
      sessionWriterRef.current!.commit(session, expectedEpoch),
    [],
  );

  // A storage failure must not cancel a session the provider already accepted:
  // the app keeps it in memory and a later refresh retries the write. Returns
  // false only when a newer generation (a logout, another login) took over.
  const persistSession = useCallback(
    async (session: StoredAuthSession, expectedEpoch: number) => {
      try {
        return await commitSession(session, expectedEpoch);
      } catch (error) {
        console.warn('La sesion sigue activa pero no pudo persistirse', error);
        if (expectedEpoch !== epochRef.current) return false;
        sessionRef.current = session;
        setSessionRevision((revision) => revision + 1);
        return true;
      }
    },
    [commitSession],
  );

  const clearAuthenticatedState = useCallback(async () => {
    const epoch = ++epochRef.current;
    setUser(null);
    sessionRef.current = null;
    setSessionRevision((revision) => revision + 1);
    setRefreshRetryAt(null);
    refreshAttemptRef.current = 0;
    syncClient.disconnect();
    try {
      await commitSession(null, epoch);
    } catch (error) {
      console.warn('No se pudo limpiar la sesion del almacenamiento', error);
    }
  }, [commitSession]);

  const setAuthToken = useCallback(
    (token: string | null) => {
      if (!token) {
        void clearAuthenticatedState();
        return;
      }
      const epoch = ++epochRef.current;
      // A token arriving from a deep link starts its own credential chain: it
      // may belong to a different account than the one currently cached.
      const session: StoredAuthSession = {
        version: 2,
        accessToken: token,
        issuedAt: Math.floor(Date.now() / 1000),
        lineage: nextSessionLineage(),
      };
      // Adopt it in memory before storage I/O so the `checkSession` that
      // follows verifies this same chain instead of opening another one.
      sessionRef.current = session;
      setSessionRevision((revision) => revision + 1);
      void persistSession(session, epoch);
    },
    [clearAuthenticatedState, persistSession],
  );

  const refreshSession = useCallback(
    async (session: StoredAuthSession, epoch: number) => {
      if (epoch !== epochRef.current) return null;
      if (!session.refreshToken) return null;
      if (refreshRef.current?.epoch === epoch) return refreshRef.current.promise;

      const promise = (async () => {
        try {
          const discovery = await AuthSession.fetchDiscoveryAsync(OIDC_ISSUER);
          const response = await AuthSession.refreshAsync(
            {
              clientId: OIDC_MOBILE_CLIENT_ID,
              refreshToken: session.refreshToken,
            },
            discovery,
          );
          if (epoch !== epochRef.current) return null;
          const refreshed = fromTokenResponse(response, session);
          // The provider may have invalidated the previous rotating refresh
          // token already. Adopt the new token in memory before SecureStore I/O
          // so this process never attempts to reuse the old credential.
          sessionRef.current = refreshed;
          setSessionRevision((revision) => revision + 1);
          setRefreshRetryAt(null);
          refreshAttemptRef.current = 0;
          await persistSession(refreshed, epoch);
          return epoch === epochRef.current ? refreshed : null;
        } catch (error) {
          // invalid_grant means the refresh session was expired, revoked, reused,
          // or otherwise rejected. Network/discovery failures remain retryable.
          if (
            error instanceof AuthSession.TokenError &&
            ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(error.code) &&
            epoch === epochRef.current
          ) {
            await clearAuthenticatedState();
          } else {
            console.warn('No se pudo renovar la sesion', error);
            // Backs off so an offline device does not retry discovery and the
            // token endpoint every five seconds for as long as it stays offline.
            if (epoch === epochRef.current) {
              refreshAttemptRef.current += 1;
              setRefreshRetryAt(Date.now() + refreshRetryDelayMs(refreshAttemptRef.current));
            }
          }
          return null;
        }
      })();
      refreshRef.current = { epoch, promise };

      try {
        return await promise;
      } finally {
        if (refreshRef.current?.promise === promise) refreshRef.current = null;
      }
    },
    [clearAuthenticatedState, persistSession],
  );

  const verifySession = useCallback(
    async (candidate: StoredAuthSession) => {
      const epoch = epochRef.current;
      let active = candidate;
      let refreshed = false;

      if (!isSessionFresh(active)) {
        const next = await refreshSession(active, epoch);
        if (!next) {
          if (!active.refreshToken && epoch === epochRef.current) await clearAuthenticatedState();
          return;
        }
        active = next;
        refreshed = true;
      }

      const fetchProfile = (accessToken: string) =>
        fetch(`${API_BASE_URL}/me`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        });

      try {
        let response = await fetchProfile(active.accessToken);
        if (epoch !== epochRef.current) return;
        if (response.status === 401 && active.refreshToken && !refreshed) {
          const latest = sessionForUnauthorizedResponse(active, sessionRef.current);
          if (latest.accessToken !== active.accessToken) {
            active = latest;
          } else {
            const next = await refreshSession(active, epoch);
            // A terminal refresh failure already cleared local state. A transient
            // discovery/network failure keeps the cached session for a later retry.
            if (!next) return;
            active = next;
          }
          response = await fetchProfile(active.accessToken);
          if (epoch !== epochRef.current) return;
        }

        if (!response.ok) {
          if (response.status === 401 && epoch === epochRef.current) await clearAuthenticatedState();
          return;
        }

        const payload = (await response.json()) as ApiResponse<UserProfile>;
        if (epoch !== epochRef.current) return;
        if (!payload.data) {
          // The token went unvalidated: drop the cached identity so hydration
          // cannot present a stale profile as an authenticated session.
          console.warn('La respuesta de perfil no contiene datos de usuario');
          setUser(null);
          const cached = sessionRef.current;
          if (cached?.user) await persistSession({ ...cached, user: undefined }, epoch);
          return;
        }

        // A concurrent refresh may have rotated tokens while this profile
        // request was in flight. Adopt the newer session only when it renews
        // the very credentials this request used; a login for another account
        // must not inherit this identity.
        const verified = { ...sessionForVerifiedProfile(active, sessionRef.current), user: payload.data };
        if (!(await persistSession(verified, epoch))) return;
        setUser(payload.data);
        setIsGuest(false);
        try {
          await storage.removeItem(GUEST_KEY);
        } catch (storageError) {
          console.warn('No se pudo limpiar la marca de invitado', storageError);
        }
        syncClient.setNamespace(`user:${payload.data.id}`);
        syncClient.connect(verified.accessToken, `user:${payload.data.id}`);
      } catch (error) {
        // Offline startup keeps the securely cached identity and tokens. A later
        // foreground transition retries validation and refresh.
        console.warn('No se pudo verificar la sesion (sin conexion)', error);
      }
    },
    [clearAuthenticatedState, persistSession, refreshSession],
  );

  const checkSession = useCallback(
    async (tokenOverride?: string) => {
      const candidate = tokenOverride
        ? // Reuse the chain `setAuthToken` just installed for this same token,
          // so a rotation started meanwhile is still recognised as its own.
          sessionRef.current?.accessToken === tokenOverride
          ? sessionRef.current
          : {
              version: 2 as const,
              accessToken: tokenOverride,
              issuedAt: Math.floor(Date.now() / 1000),
              lineage: nextSessionLineage(),
            }
        : sessionRef.current;
      if (!candidate) {
        setUser(null);
        return;
      }
      await verifySession(candidate);
    },
    [verifySession],
  );

  useEffect(() => {
    let cancelled = false;
    const hydrationEpoch = epochRef.current;

    (async () => {
      try {
        const [savedSession, savedGuest] = await Promise.all([readSession(), storage.getItem(GUEST_KEY)]);
        if (cancelled || hydrationEpoch !== epochRef.current) return;

        if (savedSession) {
          sessionRef.current = savedSession;
          setSessionRevision((revision) => revision + 1);
          if (savedSession.user) setUser(savedSession.user);
          await verifySession(savedSession);
        } else if (savedGuest === '1') {
          setIsGuest(true);
        }
      } catch (error) {
        console.warn('No se pudo leer la sesion guardada', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      epochRef.current += 1;
    };
  }, [verifySession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && sessionRef.current) void verifySession(sessionRef.current);
    });
    return () => subscription.remove();
  }, [verifySession]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session?.refreshToken) return;
    const delay = refreshDelayMs(session, Date.now(), refreshRetryAt);
    if (delay === null) return;
    const timer = setTimeout(() => {
      if (sessionRef.current) void verifySession(sessionRef.current);
    }, delay);
    return () => clearTimeout(timer);
  }, [refreshRetryAt, sessionRevision, verifySession]);

  const enableGuestMode = useCallback(async () => {
    await clearAuthenticatedState();
    setIsGuest(true);
    syncClient.setNamespace('guest');
    await storage.setItem(GUEST_KEY, '1');
    await fetchOfficialTemplates();
  }, [clearAuthenticatedState]);

  const loginWithGoogle = useCallback(async () => {
    setIsLoading(true);
    try {
      const discovery = await AuthSession.fetchDiscoveryAsync(OIDC_ISSUER);
      const configuredScheme = Constants.expoConfig?.scheme;
      const scheme = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: typeof scheme === 'string' ? scheme : 'balance',
        path: 'auth-callback',
      });
      const request = new AuthSession.AuthRequest({
        clientId: OIDC_MOBILE_CLIENT_ID,
        responseType: AuthSession.ResponseType.Code,
        redirectUri: redirectUrl,
        scopes: AUTH_SCOPES,
        usePKCE: true,
      });
      const result = await request.promptAsync(discovery);
      if (result.type !== 'success' || !result.params.code || !request.codeVerifier) return;
      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId: OIDC_MOBILE_CLIENT_ID,
          code: result.params.code,
          redirectUri: redirectUrl,
          extraParams: { code_verifier: request.codeVerifier },
        },
        discovery,
      );
      if (!tokenResponse.accessToken) return;
      const session = fromTokenResponse(tokenResponse);
      const epoch = ++epochRef.current;
      if (!(await persistSession(session, epoch))) return;
      await verifySession(session);
    } catch (error) {
      console.error('Fallo el login con Google', error);
    } finally {
      setIsLoading(false);
    }
  }, [persistSession, verifySession]);

  const logout = useCallback(async () => {
    const refreshToken = sessionRef.current?.refreshToken;
    setIsGuest(false);
    await clearAuthenticatedState();
    try {
      await storage.removeItem(GUEST_KEY);
    } catch (storageError) {
      console.warn('No se pudo limpiar la marca de invitado', storageError);
    }
    // Nothing to revoke on web, where refresh tokens are never persisted, nor
    // for migrated v1 sessions. Skip discovery so logout stays local and
    // immediate instead of waiting on a network round-trip.
    if (!refreshToken) return;
    try {
      const discovery = await AuthSession.fetchDiscoveryAsync(OIDC_ISSUER);
      if (discovery.revocationEndpoint) {
        await AuthSession.revokeAsync(
          {
            clientId: OIDC_MOBILE_CLIENT_ID,
            token: refreshToken,
            tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken,
          },
          discovery,
        );
      }
    } catch {
      // Local logout must succeed even when revocation is unavailable/offline.
    }
  }, [clearAuthenticatedState]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated: !!user,
      isGuest,
      isLoading,
      loginWithGoogle,
      enableGuestMode,
      logout,
      setAuthToken,
      checkSession,
    }),
    [user, isGuest, isLoading, loginWithGoogle, enableGuestMode, logout, setAuthToken, checkSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de un AuthProvider');
  return context;
};
