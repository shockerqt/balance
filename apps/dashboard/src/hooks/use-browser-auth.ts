import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  OIDC_SSO_MARKER_KEY,
  OIDC_TRANSACTION_KEY,
  authorizationCodeBody,
  buildAuthorizationUrl,
  createOidcTransaction,
  parseOidcCallback,
  parseStoredTransaction,
  refreshTokenBody,
  sanitizedReturnTo,
  tokenEndpoint,
  type OidcPrompt,
  type TokenResponse,
} from '../services/auth/browser-oidc.ts';
import { getDashboardServiceConfig } from '../services/config.ts';
import type { ApiResponse, UserProfile } from '../types/user.ts';

interface BrowserSession {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number;
}

export interface BrowserAuthState {
  user: UserProfile | null;
  accessToken: string | null;
  isLoading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

function sessionFromTokens(tokens: TokenResponse, previous: BrowserSession | null = null): BrowserSession | null {
  if (!tokens.access_token) return null;
  const expiresIn = Number.isFinite(tokens.expires_in) ? Math.max(1, Number(tokens.expires_in)) : 300;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? null,
    idToken: tokens.id_token ?? previous?.idToken ?? null,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

async function readTokenResponse(response: Response): Promise<TokenResponse> {
  const payload = (await response.json().catch(() => null)) as TokenResponse | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(`OIDC token exchange failed (${response.status})`);
  }
  return payload;
}

export function useBrowserAuth(): BrowserAuthState {
  const config = useMemo(() => getDashboardServiceConfig(), []);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<BrowserSession | null>(null);
  const bootstrappedRef = useRef(false);
  const mountedRef = useRef(true);
  const refreshPromiseRef = useRef<Promise<BrowserSession | null> | null>(null);

  const clearState = useCallback((clearMarker: boolean) => {
    sessionRef.current = null;
    setAccessToken(null);
    setUser(null);
    if (clearMarker) window.localStorage.removeItem(OIDC_SSO_MARKER_KEY);
  }, []);

  const verifyProfile = useCallback(async (session: BrowserSession): Promise<UserProfile> => {
    const response = await fetch(`${config.apiBaseUrl}/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!response.ok) throw new Error(`Balance profile rejected the session (${response.status})`);
    const payload = (await response.json()) as ApiResponse<UserProfile>;
    if (!payload.data) throw new Error('Balance profile response did not contain a user');
    return payload.data;
  }, [config.apiBaseUrl]);

  const adoptVerifiedSession = useCallback(async (session: BrowserSession) => {
    const profile = await verifyProfile(session);
    sessionRef.current = session;
    setUser(profile);
    setAccessToken(session.accessToken);
    window.localStorage.setItem(OIDC_SSO_MARKER_KEY, '1');
    setError(null);
    return session;
  }, [verifyProfile]);

  const refreshSession = useCallback(async (): Promise<BrowserSession | null> => {
    const current = sessionRef.current;
    if (!current?.refreshToken) return null;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const promise = (async () => {
      try {
        const response = await fetch(tokenEndpoint(config), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: refreshTokenBody(config, current.refreshToken),
        });
        const next = sessionFromTokens(await readTokenResponse(response), current);
        if (!next || sessionRef.current !== current) return null;
        sessionRef.current = next;
        setAccessToken(next.accessToken);
        setError(null);
        return next;
      } catch (refreshError) {
        if (sessionRef.current === current) {
          clearState(true);
          setError(refreshError instanceof Error ? refreshError.message : 'Session refresh failed');
        }
        return null;
      }
    })();
    refreshPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (refreshPromiseRef.current === promise) refreshPromiseRef.current = null;
    }
  }, [clearState, config]);

  const beginAuthorization = useCallback(async (prompt: OidcPrompt) => {
    setIsLoading(true);
    setError(null);
    const returnTo = sanitizedReturnTo(`${window.location.pathname}${window.location.hash}`);
    const transaction = createOidcTransaction(config.oidcRedirectUri, returnTo, prompt);
    window.sessionStorage.setItem(OIDC_TRANSACTION_KEY, JSON.stringify(transaction));
    const url = await buildAuthorizationUrl(config, transaction);
    window.location.assign(url);
  }, [config]);

  const login = useCallback(() => beginAuthorization('login'), [beginAuthorization]);

  const logout = useCallback(async () => {
    clearState(true);
    setError(null);
    window.sessionStorage.removeItem(OIDC_TRANSACTION_KEY);
    try {
      await fetch(`${config.apiBaseUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // The legacy cookie cleanup is best-effort. Browser auth state is already gone.
    }
  }, [clearState, config.apiBaseUrl]);

  useEffect(() => {
    mountedRef.current = true;
    if (bootstrappedRef.current) {
      return () => {
        mountedRef.current = false;
      };
    }
    bootstrappedRef.current = true;

    void (async () => {
      const stored = parseStoredTransaction(window.sessionStorage.getItem(OIDC_TRANSACTION_KEY));
      const callback = parseOidcCallback(window.location.search, stored);

      if (callback.type === 'none') {
        if (window.localStorage.getItem(OIDC_SSO_MARKER_KEY) === '1') {
          await beginAuthorization('none');
          return;
        }
        if (mountedRef.current) setIsLoading(false);
        return;
      }

      window.sessionStorage.removeItem(OIDC_TRANSACTION_KEY);
      const returnTo = callback.type === 'code' || callback.type === 'error'
        ? callback.transaction?.returnTo ?? '/'
        : '/';
      window.history.replaceState({}, '', sanitizedReturnTo(returnTo));

      if (callback.type === 'invalid') {
        clearState(true);
        if (mountedRef.current) {
          setError(`Invalid OIDC callback: ${callback.reason}`);
          setIsLoading(false);
        }
        return;
      }

      if (callback.type === 'error') {
        clearState(true);
        if (mountedRef.current) {
          if (callback.transaction?.prompt !== 'none') setError(callback.description ?? callback.error);
          setIsLoading(false);
        }
        return;
      }

      try {
        const response = await fetch(tokenEndpoint(config), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: authorizationCodeBody(config, callback.code, callback.transaction),
        });
        const session = sessionFromTokens(await readTokenResponse(response));
        if (!session) throw new Error('OIDC token response did not contain an access token');
        if (!mountedRef.current) return;
        await adoptVerifiedSession(session);
      } catch (callbackError) {
        if (mountedRef.current) {
          clearState(true);
          setError(callbackError instanceof Error ? callbackError.message : 'Authentication failed');
        }
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, [adoptVerifiedSession, beginAuthorization, clearState, config]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || session.accessToken !== accessToken || !session.refreshToken) return;
    const delay = Math.max(5_000, session.expiresAt - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      void refreshSession();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [accessToken, refreshSession]);

  return { user, accessToken, isLoading, error, login, logout };
}
