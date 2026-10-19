import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { syncClient } from '@/services/sync/sync-client';
import { fetchOfficialTemplates } from '@/services/sync/official-templates';
import { API_BASE_URL, OIDC_ISSUER, OIDC_MOBILE_CLIENT_ID, OIDC_RESOURCE, OIDC_SCOPES, OIDC_BROWSER_LOGOUT_URL, OIDC_REDIRECT_URI } from '@/services/config';
import { storage } from '@/services/storage';
import {
  assertAuthorizationResponseIssuer,
  assertStagingMobileRedirect,
  chosenMobileRedirect,
  awaitCurrentAuthStep,
  authDataNamespace,
  browserLogoutRequest,
  BrowserLogoutStatus,
  isValidLogoutReturn,
  retryUnauthorizedRequest,
  oauthResourceParams,
  sessionForAuthContext,
  SessionBinding,
  refreshDelayMs,
  refreshRetryDelayMs,
  isSessionFresh,
  LOGGED_OUT_MARKER,
  LEGACY_TOKEN_KEY,
  LEGACY_WEB_TOKEN_KEY,
  mergeRefreshedSession,
  nextSessionLineage,
  resolveStoredSession,
  SerializedSessionWriter,
  SESSION_KEY,
  sessionForUnauthorizedResponse,
  sessionForVerifiedProfile,
  sessionWritePlan,
  StoredAuthSession,
  StoredUserProfile,
} from '@/services/auth/session-state';

WebBrowser.maybeCompleteAuthSession();

export type UserProfile = StoredUserProfile;

interface ApiResponse<T> {
  data?: T | null;
}

const GUEST_KEY = '@balance_guest_v1';
const AUTH_BINDING: SessionBinding = {
  issuer: OIDC_ISSUER,
  clientId: OIDC_MOBILE_CLIENT_ID,
  resource: OIDC_RESOURCE,
  apiBaseUrl: API_BASE_URL,
};

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
  const isWeb = Platform.OS === 'web';
  const [record, legacyToken, legacyWebToken] = await Promise.all([
    readValue(SESSION_KEY),
    readValue(LEGACY_TOKEN_KEY),
    isWeb ? storage.getItem(LEGACY_WEB_TOKEN_KEY) : Promise.resolve(null),
  ]);
  return resolveStoredSession(record, legacyToken ?? legacyWebToken, isWeb);
};

// Sequential on purpose: the plan's ordering is what keeps an interrupted
// write safe, and running the steps in parallel would throw it away.
const writeSession = async (session: StoredAuthSession | null) => {
  for (const { key, value } of sessionWritePlan(session, Platform.OS === 'web')) {
    await writeValue(key, value);
  }
};

const fromTokenResponse = (response: AuthSession.TokenResponse, previous?: StoredAuthSession): StoredAuthSession =>
  mergeRefreshedSession(
    previous ?? {
      version: 2,
      accessToken: response.accessToken,
      issuedAt: response.issuedAt,
      lineage: nextSessionLineage(),
      binding: { ...AUTH_BINDING },
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
    Platform.OS === 'web',
  );

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  isLoading: boolean;
  loginWithGoogle: () => Promise<void>;
  enableGuestMode: () => Promise<boolean>;
  logout: () => Promise<BrowserLogoutStatus>;
  setAuthToken: (token: string | null) => void;
  checkSession: (tokenOverride?: string) => Promise<void>;
  authorizedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  refreshReplayAvailable: boolean;
  runRefreshReplay: () => Promise<RefreshReplayResult>;
  providerLogoutAvailable: boolean;
  providerLogoutNotice: ProviderLogoutDiagnostic | null;
  runProviderLogoutDiagnostic: () => Promise<ProviderLogoutDiagnostic>;
  dismissProviderLogoutNotice: () => void;
}

export type RefreshReplayResult = {
  status: 'PASS' | 'FAIL' | 'UNCONFIRMED';
  step: 'precondition' | 'rotation' | 'replay' | 'family';
  reason: 'unavailable' | 'busy' | 'expired' | 'transport' | 'storage' | 'missing_rotation' | 'accepted' | 'invalid_grant';
};

const replayBindingAllowed = (scheme: unknown, variant: unknown) =>
  __DEV__ && (Platform.OS === 'android' || Platform.OS === 'ios') &&
  variant === 'development' && scheme === 'balance-dev' &&
  process.env.EXPO_PUBLIC_AUTH_DIAGNOSTICS === '1' &&
  OIDC_ISSUER === 'https://auth-staging.shocker.cl' &&
  OIDC_MOBILE_CLIENT_ID === 'balance-mobile-staging' &&
  OIDC_RESOURCE === 'https://balance-staging.shocker.cl/api' &&
  API_BASE_URL === 'https://balance-staging.shocker.cl/api';

const configuredScheme = Constants.expoConfig?.scheme;
export const REFRESH_REPLAY_AVAILABLE = replayBindingAllowed(
  Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme,
  Constants.expoConfig?.extra?.appVariant,
);
const DIAGNOSTIC_DEADLINE_MS = 30000;
const PROVIDER_DIAGNOSTIC_DEADLINE_MS = 5 * 60 * 1000;
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

type Discovery = Awaited<ReturnType<typeof AuthSession.fetchDiscoveryAsync>>;

const requestRefresh = (refreshToken: string, discovery: Discovery) => AuthSession.refreshAsync({
  clientId: OIDC_MOBILE_CLIENT_ID, refreshToken,
  extraParams: oauthResourceParams(OIDC_RESOURCE),
}, discovery);

const requestAuthorization = async (
  discovery: Discovery, isCurrent: () => boolean, nonce?: string,
  onExchangeStart?: () => () => void,
): Promise<AuthSession.TokenResponse | undefined> => {
  const schemeValue = Constants.expoConfig?.scheme;
  const scheme = Array.isArray(schemeValue) ? schemeValue[0] : schemeValue;
  const chosenRedirect = chosenMobileRedirect(AUTH_BINDING, typeof scheme === 'string' ? scheme : 'balance',
    Platform.OS, Constants.expoConfig?.extra?.appVariant, OIDC_REDIRECT_URI);
  const redirectUrl = chosenRedirect ?? AuthSession.makeRedirectUri({
    scheme: typeof scheme === 'string' ? scheme : 'balance', path: 'auth-callback',
  });
  assertStagingMobileRedirect(AUTH_BINDING, typeof scheme === 'string' ? scheme : 'balance', redirectUrl, chosenRedirect);
  const request = new AuthSession.AuthRequest({
    clientId: OIDC_MOBILE_CLIENT_ID,
    responseType: AuthSession.ResponseType.Code,
    redirectUri: redirectUrl,
    scopes: OIDC_SCOPES,
    extraParams: { ...oauthResourceParams(OIDC_RESOURCE), ...(nonce ? { nonce } : {}) },
    usePKCE: true,
  });
  const result = await awaitCurrentAuthStep(
    request.promptAsync(discovery, nonce ? { preferEphemeralSession: false } : undefined), isCurrent,
  );
  if (!result || result.type !== 'success' || !result.params.code || !request.codeVerifier) return;
  const metadata = discovery.discoveryDocument as
    { authorization_response_iss_parameter_supported?: boolean } | undefined;
  assertAuthorizationResponseIssuer(OIDC_ISSUER, result.params.iss,
    metadata?.authorization_response_iss_parameter_supported === true);
  const finishExchange = onExchangeStart?.();
  try {
    return await AuthSession.exchangeCodeAsync({
      clientId: OIDC_MOBILE_CLIENT_ID,
      code: result.params.code,
      redirectUri: redirectUrl,
      extraParams: { ...oauthResourceParams(OIDC_RESOURCE), code_verifier: request.codeVerifier },
    }, discovery);
  } catch (error) {
    if (isCurrent()) throw error;
    return;
  } finally { finishExchange?.(); }
};

const revokeRefresh = async (refreshToken: string, discovery?: Discovery): Promise<boolean> => {
  try {
    const resolved = discovery ?? await AuthSession.fetchDiscoveryAsync(OIDC_ISSUER);
    if (!resolved.revocationEndpoint) return false;
    const revoked = await AuthSession.revokeAsync({
      clientId: OIDC_MOBILE_CLIENT_ID, token: refreshToken,
      tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken,
    }, resolved);
    return revoked === true;
  } catch { return false; }
};

const openProviderLogout = async (isCurrent: () => boolean, stateOverride?: string): Promise<BrowserLogoutStatus> => {
  if (!OIDC_BROWSER_LOGOUT_URL) return 'not_requested';
  try {
    const schemeValue = Constants.expoConfig?.scheme;
    const scheme = Array.isArray(schemeValue) ? schemeValue[0] : schemeValue;
    const redirect = AuthSession.makeRedirectUri({ scheme, path: 'logout-callback' });
    const state = stateOverride ?? toHex(await Crypto.getRandomBytesAsync(32));
    if (!isCurrent()) return 'unconfirmed';
    const url = browserLogoutRequest(AUTH_BINDING, OIDC_BROWSER_LOGOUT_URL,
      typeof scheme === 'string' ? scheme : '', Platform.OS, redirect, state);
    const result = await WebBrowser.openAuthSessionAsync(url, redirect, { preferEphemeralSession: false });
    return isCurrent() && result.type === 'success' && isValidLogoutReturn(result.url, redirect, state)
      ? 'confirmed' : 'unconfirmed';
  } catch { return 'unconfirmed'; }
};

export type ProviderLogoutDiagnostic = {
  status: 'UNCONFIRMED' | 'FAIL';
  step: 'precondition' | 'authorize_a' | 'authorize_b' | 'refresh_a' | 'refresh_b' | 'clear' | 'logout' | 'probe_b' | 'cleanup';
  reason: 'unavailable' | 'expired' | 'cancelled' | 'transport' | 'missing_rotation' | 'storage' | 'cleanup' | 'accepted' | 'provider_proof_pending';
  reference?: string;
  revocationConfirmed?: boolean;
  cleanupIssue?: 'storage' | 'revoke';
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [browserBusy, setBrowserBusy] = useState(false);
  const browserOperationRef = useRef<{ kind: 'login' | 'logout' | 'diagnostic'; owner: symbol } | null>(null);
  const diagnosticOwnerRef = useRef<symbol | null>(null);
  const guestTransitionRef = useRef(false);
  const [providerLogoutNotice, setProviderLogoutNotice] = useState<ProviderLogoutDiagnostic | null>(null);
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
        if (!diagnosticOwnerRef.current) console.warn('La sesion sigue activa pero no pudo persistirse', error);
        if (expectedEpoch !== epochRef.current) return false;
        sessionRef.current = session;
        setSessionRevision((revision) => revision + 1);
        return true;
      }
    },
    [commitSession],
  );

  // Every new set of credentials goes through here. Publishing them to
  // `sessionRef` synchronously, before any storage I/O, keeps the ref in step
  // with `epochRef`: a timer or an AppState check that fires mid-write must
  // never see the new epoch paired with the previous account's session and
  // persist that back over this one.
  const adoptSession = useCallback(
    (session: StoredAuthSession, expectedEpoch: number) => {
      if (expectedEpoch !== epochRef.current) return Promise.resolve(false);
      sessionRef.current = session;
      setSessionRevision((revision) => revision + 1);
      return persistSession(session, expectedEpoch);
    },
    [persistSession],
  );

  const clearAuthenticatedState = useCallback(async (diagnostic = false) => {
    const epoch = ++epochRef.current;
    setIsLoading(false);
    setUser(null);
    sessionRef.current = null;
    setSessionRevision((revision) => revision + 1);
    setRefreshRetryAt(null);
    refreshAttemptRef.current = 0;
    syncClient.disconnect();
    try {
      await commitSession(null, epoch);
    } catch (error) {
      if (diagnostic) throw new Error('diagnostic_storage');
      console.warn('No se pudo limpiar la sesion del almacenamiento', error);
    }
    return epoch;
  }, [commitSession]);

  const setAuthToken = useCallback(
    (token: string | null) => {
      if (diagnosticOwnerRef.current) return;
      if (!token) {
        void clearAuthenticatedState();
        return;
      }
      const epoch = ++epochRef.current;
      setIsLoading(false);
      setUser(null);
      syncClient.disconnect();
      // A token arriving from a deep link starts its own credential chain: it
      // may belong to a different account than the one currently cached.
      // Adopting it before the I/O also lets the `checkSession` that follows
      // verify this same chain instead of opening another one.
      void adoptSession(
        {
          version: 2,
          accessToken: token,
          issuedAt: Math.floor(Date.now() / 1000),
          lineage: nextSessionLineage(),
          binding: { ...AUTH_BINDING },
        },
        epoch,
      );
    },
    [adoptSession, clearAuthenticatedState],
  );

  const refreshSession = useCallback(
    async (session: StoredAuthSession, epoch: number) => {
      if (diagnosticOwnerRef.current) return null;
      if (epoch !== epochRef.current) return null;
      if (!sessionForAuthContext(session, AUTH_BINDING)) return null;
      if (!session.refreshToken) return null;
      if (refreshRef.current?.epoch === epoch) return refreshRef.current.promise;

      const promise = (async () => {
        try {
          const discovery = await AuthSession.fetchDiscoveryAsync(OIDC_ISSUER);
          if (epoch !== epochRef.current) return null;
          const response = await requestRefresh(session.refreshToken!, discovery);
          if (epoch !== epochRef.current) return null;
          const refreshed = fromTokenResponse(response, session);
          setRefreshRetryAt(null);
          refreshAttemptRef.current = 0;
          // The provider may have invalidated the previous rotating refresh
          // token already, so this process must never fall back to it.
          await adoptSession(refreshed, epoch);
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
            console.warn('No se pudo renovar la sesion');
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
    [adoptSession, clearAuthenticatedState],
  );

  const verifySession = useCallback(
    async (candidate: StoredAuthSession) => {
      if (diagnosticOwnerRef.current) return;
      const epoch = epochRef.current;
      const isCurrent = () => epoch === epochRef.current && !diagnosticOwnerRef.current;
      let active = sessionForAuthContext(candidate, AUTH_BINDING);
      if (!active) {
        await clearAuthenticatedState();
        return;
      }
      let refreshed = false;

      if (!isSessionFresh(active)) {
        const next = await refreshSession(active, epoch);
        if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        let response = await fetchProfile(active.accessToken);
        if (!isCurrent()) return;
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
          if (!isCurrent()) return;
          response = await fetchProfile(active.accessToken);
          if (!isCurrent()) return;
        }

        if (!response.ok) {
          if (response.status === 401 && epoch === epochRef.current) await clearAuthenticatedState();
          return;
        }

        const payload = (await response.json()) as ApiResponse<UserProfile>;
        if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        setUser(payload.data);
        setIsGuest(false);
        try {
          await storage.removeItem(GUEST_KEY);
        } catch (storageError) {
          console.warn('No se pudo limpiar la marca de invitado', storageError);
        }
        if (!isCurrent()) return;
        syncClient.setNamespace(authDataNamespace(API_BASE_URL, payload.data.id));
        syncClient.connect(verified.accessToken, authDataNamespace(API_BASE_URL, payload.data.id));
      } catch (error) {
        // Offline startup keeps the securely cached identity and tokens. A later
        // foreground transition retries validation and refresh.
        if (!diagnosticOwnerRef.current) console.warn('No se pudo verificar la sesion (sin conexion)', error);
      }
    },
    [clearAuthenticatedState, persistSession, refreshSession],
  );

  const checkSession = useCallback(
    async (tokenOverride?: string) => {
      if (diagnosticOwnerRef.current) return;
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
              binding: { ...AUTH_BINDING },
            }
        : sessionRef.current;
      if (!candidate) {
        setUser(null);
        return;
      }
      if (tokenOverride && sessionRef.current?.accessToken !== tokenOverride) {
        const epoch = ++epochRef.current;
        setIsLoading(false);
        setUser(null);
        syncClient.disconnect();
        if (!(await adoptSession(candidate, epoch))) return;
      }
      await verifySession(candidate);
    },
    [adoptSession, verifySession],
  );

  useEffect(() => {
    let cancelled = false;
    const hydrationEpoch = epochRef.current;

    (async () => {
      try {
        const [rawSession, savedGuest] = await Promise.all([readSession(), storage.getItem(GUEST_KEY)]);
        if (cancelled || diagnosticOwnerRef.current || hydrationEpoch !== epochRef.current) return;
        const savedSession = sessionForAuthContext(rawSession, AUTH_BINDING);
        if (rawSession && !savedSession) {
          // Discard credentials/profile before any provider or backend request.
          await commitSession(null, hydrationEpoch);
          if (cancelled || hydrationEpoch !== epochRef.current) return;
        }
        if (savedSession) {
          if (!(await adoptSession(savedSession, hydrationEpoch))) return;
          if (cancelled || hydrationEpoch !== epochRef.current) return;
          if (savedSession.user) setUser(savedSession.user);
          await verifySession(savedSession);
        } else if (savedGuest === '1') {
          setIsGuest(true);
        }
      } catch (error) {
        console.warn('No se pudo leer la sesion guardada', error);
      } finally {
        if (!cancelled && hydrationEpoch === epochRef.current) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      epochRef.current += 1;
    };
  }, [adoptSession, commitSession, verifySession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !diagnosticOwnerRef.current && sessionRef.current) void verifySession(sessionRef.current);
    });
    return () => subscription.remove();
  }, [verifySession]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session?.refreshToken) return;
    const delay = refreshDelayMs(session, Date.now(), refreshRetryAt);
    if (delay === null) return;
    const timer = setTimeout(() => {
      if (!diagnosticOwnerRef.current && sessionRef.current) void verifySession(sessionRef.current);
    }, delay);
    return () => clearTimeout(timer);
  }, [refreshRetryAt, sessionRevision, verifySession]);

  const enableGuestMode = useCallback(async () => {
    if (diagnosticOwnerRef.current || guestTransitionRef.current) return false;
    guestTransitionRef.current = true;
    try {
      const epoch = await clearAuthenticatedState();
      if (epoch !== epochRef.current || diagnosticOwnerRef.current) return false;
      syncClient.setNamespace('guest');
      await storage.setItem(GUEST_KEY, '1');
      if (epoch !== epochRef.current || diagnosticOwnerRef.current) return false;
      setIsGuest(true);
      void fetchOfficialTemplates();
      return true;
    } finally { guestTransitionRef.current = false; }
  }, [clearAuthenticatedState]);

  const loginWithGoogle = useCallback(async () => {
    // A generation guard cannot undo remote browser logout. Hold one owner
    // synchronously until the browser operation ends; never queue another.
    if (browserOperationRef.current || diagnosticOwnerRef.current) return;
    const owner = Symbol('login');
    browserOperationRef.current = { kind: 'login', owner };
    setBrowserBusy(true);
    let loginEpoch = ++epochRef.current;
    const isCurrent = () => loginEpoch === epochRef.current;
    setIsLoading(true);
    try {
      const discovery = await awaitCurrentAuthStep(AuthSession.fetchDiscoveryAsync(OIDC_ISSUER), isCurrent);
      if (!discovery) return;
      const tokenResponse = await requestAuthorization(discovery, isCurrent);
      if (!tokenResponse?.accessToken || !isCurrent()) return;
      const session = fromTokenResponse(tokenResponse);
      // Adoption starts a new credential generation, invalidating any refresh
      // of the previous account that began while the browser was open.
      loginEpoch = ++epochRef.current;
      setUser(null);
      syncClient.disconnect();
      if (!(await adoptSession(session, loginEpoch)) || !isCurrent()) return;
      await verifySession(session);
    } catch {
      if (isCurrent()) console.warn('Fallo el login con Google');
    } finally {
      if (isCurrent()) setIsLoading(false);
      if (browserOperationRef.current?.owner === owner) {
        browserOperationRef.current = null;
        setBrowserBusy(false);
      }
    }
  }, [adoptSession, verifySession]);

  const logout = useCallback(async (): Promise<BrowserLogoutStatus> => {
    if (diagnosticOwnerRef.current) return 'in_progress';
    if (browserOperationRef.current?.kind === 'logout') return 'in_progress';
    const owner = OIDC_BROWSER_LOGOUT_URL === undefined || browserOperationRef.current
      ? null : Symbol('logout');
    if (owner) {
      browserOperationRef.current = { kind: 'logout', owner };
      setBrowserBusy(true);
    }
    const active = sessionForAuthContext(sessionRef.current, AUTH_BINDING);
    const refreshToken = active?.refreshToken;
    setIsGuest(false);
    // Clear memory/credentials and disconnect sockets before the first await.
    const clearing = clearAuthenticatedState();
    const logoutEpoch = epochRef.current;
    const isCurrent = () => logoutEpoch === epochRef.current;
    const revocation = refreshToken ? revokeRefresh(refreshToken) : Promise.resolve(false);
    // Staging browser logout must not wait for an offline revocation request.
    // This promise catches internally and only ever uses captured credentials.
    if (OIDC_BROWSER_LOGOUT_URL !== undefined) void revocation;
    try {
      await clearing;
      if (!isCurrent()) return 'unconfirmed';
      try { await storage.removeItem(GUEST_KEY); }
      catch { console.warn('No se pudo limpiar la marca de invitado'); }
      if (!isCurrent()) return 'unconfirmed';
      if (OIDC_BROWSER_LOGOUT_URL === undefined) {
        await revocation;
        return 'not_requested';
      }
      // An in-progress login was invalidated above, but its browser still owns
      // the cookie context. Never schedule logout behind that login.
      if (!owner) return 'unconfirmed';
      return await openProviderLogout(isCurrent);
    } catch {
      return 'unconfirmed';
    } finally {
      if (owner && browserOperationRef.current?.owner === owner) {
        browserOperationRef.current = null;
        setBrowserBusy(false);
      }
    }
  }, [clearAuthenticatedState]);

  const authorizedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (diagnosticOwnerRef.current) throw new Error('Operación temporalmente no disponible');
      const epoch = epochRef.current;
      let session = sessionRef.current;
      if (!session || !sessionForAuthContext(session, AUTH_BINDING))
        throw new Error('Debes iniciar sesión para importar al servidor');
      if (!isSessionFresh(session)) {
        const refreshed = await refreshSession(session, epoch);
        if (diagnosticOwnerRef.current || epoch !== epochRef.current)
          throw new Error('Operación temporalmente no disponible');
        if (!refreshed) throw new Error('No se pudo renovar la sesión');
        session = refreshed;
      }

      const request = (accessToken: string) => {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${accessToken}`);
        if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
      };

      const response = await request(session.accessToken);
      if (diagnosticOwnerRef.current) return response;
      if (response.status !== 401 || epoch !== epochRef.current) return response;
      const latest = sessionForUnauthorizedResponse(session, sessionRef.current);
      return retryUnauthorizedRequest(
        response,
        async () => diagnosticOwnerRef.current ? null : latest.accessToken !== session.accessToken ? latest : refreshSession(session, epoch),
        () => !diagnosticOwnerRef.current && epoch === epochRef.current,
        request,
        clearAuthenticatedState,
      );
    },
    [clearAuthenticatedState, refreshSession],
  );

  const runRefreshReplay = useCallback((): Promise<RefreshReplayResult> => {
    const unavailable: RefreshReplayResult = { status: 'UNCONFIRMED', step: 'precondition', reason: 'unavailable' };
    if (!REFRESH_REPLAY_AVAILABLE || isGuest || !user || browserOperationRef.current || diagnosticOwnerRef.current ||
        !sessionForAuthContext(sessionRef.current, AUTH_BINDING)?.refreshToken) return Promise.resolve(unavailable);
    // Own every auth entry point before waiting for an older refresh. That
    // refresh may rotate remotely and must finish adopting before R0 is read.
    const owner = Symbol('refresh-replay');
    diagnosticOwnerRef.current = owner;
    let expired = false;
    let phase: RefreshReplayResult['step'] = 'precondition';
    let timeout: ReturnType<typeof setTimeout>;
    const run = (async (): Promise<RefreshReplayResult> => {
      try {
        const previousRefresh = refreshRef.current?.promise;
        if (previousRefresh) await previousRefresh;
        if (expired) return { status: 'UNCONFIRMED', step: 'precondition', reason: 'expired' };
        const current = sessionForAuthContext(sessionRef.current, AUTH_BINDING);
        if (browserOperationRef.current || isGuest || !user || !current?.refreshToken)
          return unavailable;
        const r0 = current.refreshToken;
        try { await clearAuthenticatedState(true); }
        catch { return { status: 'UNCONFIRMED', step: 'precondition', reason: 'storage' }; }
        phase = 'rotation';
        if (expired) return { status: 'UNCONFIRMED', step: 'rotation', reason: 'expired' };
        const discovery = await AuthSession.fetchDiscoveryAsync(OIDC_ISSUER);
        if (expired) return { status: 'UNCONFIRMED', step: 'rotation', reason: 'expired' };
        const refresh = (refreshToken: string) => AuthSession.refreshAsync({
          clientId: OIDC_MOBILE_CLIENT_ID, refreshToken,
          extraParams: oauthResourceParams(OIDC_RESOURCE),
        }, discovery);
        let rotated: AuthSession.TokenResponse;
        try { rotated = await refresh(r0); }
        catch { return { status: 'UNCONFIRMED', step: 'rotation', reason: 'transport' }; }
        if (expired) return { status: 'UNCONFIRMED', step: 'rotation', reason: 'expired' };
        const r1 = rotated.refreshToken;
        if (!r1 || !r1.trim() || r1 === r0)
          return { status: 'UNCONFIRMED', step: 'rotation', reason: 'missing_rotation' };
        const expectInvalidGrant = async (token: string, step: 'replay' | 'family'): Promise<RefreshReplayResult | null> => {
          try { await refresh(token); return { status: 'FAIL', step, reason: 'accepted' }; }
          catch (error) {
            if (expired) return { status: 'UNCONFIRMED', step, reason: 'expired' };
            return error instanceof AuthSession.TokenError && error.code === 'invalid_grant'
              ? null : { status: 'UNCONFIRMED', step, reason: 'transport' };
          }
        };
        phase = 'replay';
        const replay = await expectInvalidGrant(r0, 'replay');
        if (expired) return { status: 'UNCONFIRMED', step: 'replay', reason: 'expired' };
        if (replay) return replay;
        phase = 'family';
        const family = await expectInvalidGrant(r1, 'family');
        if (expired) return { status: 'UNCONFIRMED', step: 'family', reason: 'expired' };
        return family ?? { status: 'PASS', step: 'family', reason: 'invalid_grant' };
      } catch {
        return { status: 'UNCONFIRMED', step: phase, reason: expired ? 'expired' : 'transport' };
      } finally {
        // A timed-out SDK request has no abort transport. Keep ownership until
        // it settles, then discard every late credential without adoption.
        if (diagnosticOwnerRef.current === owner) diagnosticOwnerRef.current = null;
      }
    })();
    const deadline = new Promise<RefreshReplayResult>(resolve => {
      timeout = setTimeout(() => {
        expired = true;
        resolve({ status: 'UNCONFIRMED', step: phase, reason: 'expired' });
      }, DIAGNOSTIC_DEADLINE_MS);
    });
    void run.finally(() => clearTimeout(timeout));
    return Promise.race([run, deadline]);
  }, [clearAuthenticatedState, isGuest, user]);

  const runProviderLogoutDiagnostic = useCallback((): Promise<ProviderLogoutDiagnostic> => {
    const unavailable: ProviderLogoutDiagnostic = {
      status: 'UNCONFIRMED', step: 'precondition', reason: 'unavailable',
    };
    if (!REFRESH_REPLAY_AVAILABLE || OIDC_BROWSER_LOGOUT_URL !== 'https://auth-staging.shocker.cl/logout' ||
        isLoading || isGuest || guestTransitionRef.current || user || sessionRef.current || browserOperationRef.current || diagnosticOwnerRef.current)
      return Promise.resolve(unavailable);

    const owner = Symbol('provider-logout-diagnostic');
    diagnosticOwnerRef.current = owner;
    browserOperationRef.current = { kind: 'diagnostic', owner };
    // Fence signed-out work that entered before this owner took control.
    ++epochRef.current;
    setBrowserBusy(true);
    setProviderLogoutNotice(null);
    let epoch = epochRef.current;
    let expired = false;
    let step: ProviderLogoutDiagnostic['step'] = 'precondition';
    let reference: string | undefined;
    let latestA: string | undefined;
    let latestB: string | undefined;
    let aCleared = false;
    let aRevoked = false;
    let bProvedInvalid = false;
    let cleanupRevocationFailure = false;
    let announced = false;
    let observedFailure: ProviderLogoutDiagnostic | null = null;
    let overallTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineResolve: (result: ProviderLogoutDiagnostic) => void = () => {};
    const deadline = new Promise<ProviderLogoutDiagnostic>(resolve => { deadlineResolve = resolve; });
    const result = (reason: ProviderLogoutDiagnostic['reason'], status: ProviderLogoutDiagnostic['status'] = 'UNCONFIRMED'): ProviderLogoutDiagnostic =>
      ({ status, step, reason, ...(reference ? { reference, revocationConfirmed: aRevoked } : {}) });
    const announce = (value: ProviderLogoutDiagnostic) => {
      const notice = observedFailure
        ? { ...observedFailure, ...(value.cleanupIssue ? { cleanupIssue: value.cleanupIssue } : {}) }
        : value;
      if (!announced || notice.status === 'FAIL' || notice.cleanupIssue || value.reason === 'storage' || value.reason === 'cleanup') {
        announced = true; setProviderLogoutNotice(notice);
      }
      return notice;
    };
    const expire = () => {
      if (expired) return;
      expired = true;
      deadlineResolve(announce(result('expired')));
    };
    const sdkDeadline = () => {
      const timer = setTimeout(expire, DIAGNOSTIC_DEADLINE_MS);
      return () => clearTimeout(timer);
    };
    const owned = () => diagnosticOwnerRef.current === owner &&
      browserOperationRef.current?.owner === owner && epochRef.current === epoch;
    const current = () => owned() && !expired;

    const run = (async (): Promise<ProviderLogoutDiagnostic> => {
      try {
        const oldRefresh = refreshRef.current?.promise;
        if (oldRefresh) await oldRefresh;
        if (!current()) return result(expired ? 'expired' : 'unavailable');
        let saved = await readValue(SESSION_KEY);
        if (!current() || sessionRef.current || user || isGuest)
          return result(expired ? 'expired' : 'unavailable');
        if (saved === null) {
          try { await clearAuthenticatedState(true); }
          catch { epoch = epochRef.current; return result('storage'); }
          epoch = epochRef.current;
          if (!current()) return result(expired ? 'expired' : 'unavailable');
          saved = await readValue(SESSION_KEY);
        }
        if (!current() || saved !== LOGGED_OUT_MARKER)
          return result(expired ? 'expired' : 'unavailable');
        const savedGuest = await storage.getItem(GUEST_KEY);
        if (!current() || savedGuest !== null)
          return result(expired ? 'expired' : 'unavailable');

        // The public reference is independent of tokens, claims and provider IDs.
        const random = await Crypto.getRandomBytesAsync(64);
        if (!current()) return result(expired ? 'expired' : 'transport');
        reference = toHex(random.slice(0, 16));
        const nonceA = `bal033v1.${reference}.A.${toHex(random.slice(16, 32))}`;
        const nonceB = `bal033v1.${reference}.B.${toHex(random.slice(32, 48))}`;
        const logoutState = reference + toHex(random.slice(48, 64));
        const discovery = await AuthSession.fetchDiscoveryAsync(OIDC_ISSUER);
        if (!current()) return result(expired ? 'expired' : 'transport');

        step = 'authorize_a';
        const tokenA = await requestAuthorization(discovery, current, nonceA, sdkDeadline);
        latestA = tokenA?.refreshToken;
        if (!current()) return result(expired ? 'expired' : 'transport');
        if (!tokenA?.accessToken || !latestA) return result('cancelled');

        step = 'authorize_b';
        const tokenB = await requestAuthorization(discovery, current, nonceB, sdkDeadline);
        latestB = tokenB?.refreshToken;
        if (!current()) return result(expired ? 'expired' : 'transport');
        if (!tokenB?.accessToken || !latestB || latestB === latestA) return result('cancelled');

        step = 'refresh_a';
        const beforeA = latestA;
        const finishA = sdkDeadline();
        let rotatedA: AuthSession.TokenResponse;
        try { rotatedA = await requestRefresh(beforeA, discovery); }
        finally { finishA(); }
        if (rotatedA.refreshToken) latestA = rotatedA.refreshToken;
        if (!current()) return result(expired ? 'expired' : 'transport');
        if (!latestA || latestA === beforeA) return result('missing_rotation');

        step = 'refresh_b';
        const beforeB = latestB;
        const finishB = sdkDeadline();
        let rotatedB: AuthSession.TokenResponse;
        try { rotatedB = await requestRefresh(beforeB, discovery); }
        finally { finishB(); }
        if (rotatedB.refreshToken) latestB = rotatedB.refreshToken;
        if (!current()) return result(expired ? 'expired' : 'transport');
        if (!latestB || latestB === beforeB) return result('missing_rotation');

        step = 'clear';
        try { await clearAuthenticatedState(true); }
        catch { epoch = epochRef.current; return result('storage'); }
        epoch = epochRef.current;
        if (!current()) return result(expired ? 'expired' : 'transport');
        aCleared = (await readValue(SESSION_KEY)) === LOGGED_OUT_MARKER;
        if (!current() || !aCleared) return result(aCleared ? 'expired' : 'storage');

        step = 'logout';
        const finishRevoke = sdkDeadline();
        try { aRevoked = await revokeRefresh(latestA, discovery); }
        finally { finishRevoke(); }
        if (!current()) return result(expired ? 'expired' : 'transport');
        if (!aRevoked) return result('transport');
        const browserStatus = await openProviderLogout(current, logoutState);
        if (!current()) return result(expired ? 'expired' : 'transport');
        if (browserStatus !== 'confirmed') return result('cancelled');

        step = 'probe_b';
        const finishProbe = sdkDeadline();
        let rejected = false;
        try {
          const probe = await requestRefresh(latestB, discovery);
          if (probe.refreshToken) latestB = probe.refreshToken;
          observedFailure = result('accepted', 'FAIL');
          announce(observedFailure);
        } catch (error) {
          rejected = error instanceof AuthSession.TokenError && error.code === 'invalid_grant';
          bProvedInvalid = rejected;
          if (!rejected) return result(expired ? 'expired' : 'transport');
        } finally { finishProbe(); }
        if (observedFailure) return observedFailure;
        if (!current()) return result(expired ? 'expired' : 'transport');
        if (!rejected) return result('accepted', 'FAIL');
        return result(aRevoked ? 'provider_proof_pending' : 'transport');
      } catch {
        return result(expired ? 'expired' : 'transport');
      } finally {
        // Only these captured families are cleaned up. A timed-out SDK call
        // remains awaited above so its late successor can be revoked here.
        step = 'cleanup';
        if (diagnosticOwnerRef.current === owner && browserOperationRef.current?.owner === owner) {
          if (latestA && !aRevoked) {
            const finish = sdkDeadline();
            try { if (!(await revokeRefresh(latestA))) cleanupRevocationFailure = true; }
            finally { finish(); }
          }
          if (latestB && !bProvedInvalid) {
            const finish = sdkDeadline();
            try { if (!(await revokeRefresh(latestB))) cleanupRevocationFailure = true; }
            finally { finish(); }
          }
          if (diagnosticOwnerRef.current === owner && browserOperationRef.current?.owner === owner) {
            diagnosticOwnerRef.current = null;
            browserOperationRef.current = null;
            setBrowserBusy(false);
          }
        }
        if (overallTimer) clearTimeout(overallTimer);
      }
    })();
    overallTimer = setTimeout(expire, PROVIDER_DIAGNOSTIC_DEADLINE_MS);
    const completed = run.then(value => {
      const issue = cleanupRevocationFailure ? 'revoke' : null;
      return announce(issue && value.status === 'FAIL'
        ? { ...value, cleanupIssue: issue }
        : issue
          ? { ...value, status: 'UNCONFIRMED', step: 'cleanup', reason: 'cleanup' }
          : value);
    });
    return Promise.race([completed, deadline]);
  }, [clearAuthenticatedState, isGuest, isLoading, user]);

  const dismissProviderLogoutNotice = useCallback(() => setProviderLogoutNotice(null), []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated: !!user,
      isGuest,
      isLoading: isLoading || browserBusy,
      loginWithGoogle,
      enableGuestMode,
      logout,
      setAuthToken,
      checkSession,
      authorizedFetch,
      refreshReplayAvailable: REFRESH_REPLAY_AVAILABLE,
      runRefreshReplay,
      providerLogoutAvailable: REFRESH_REPLAY_AVAILABLE &&
        OIDC_BROWSER_LOGOUT_URL === 'https://auth-staging.shocker.cl/logout',
      providerLogoutNotice,
      runProviderLogoutDiagnostic,
      dismissProviderLogoutNotice,
    }),
    [user, isGuest, isLoading, browserBusy, loginWithGoogle, enableGuestMode, logout, setAuthToken, checkSession, authorizedFetch, runRefreshReplay, providerLogoutNotice, runProviderLogoutDiagnostic, dismissProviderLogoutNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de un AuthProvider');
  return context;
};
