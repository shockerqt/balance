import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { syncClient } from '@/services/sync/sync-client';
import { fetchOfficialTemplates } from '@/services/sync/official-templates';
import { API_BASE_URL, OIDC_ISSUER, OIDC_MOBILE_CLIENT_ID } from '@/services/config';
import { storage } from '@/services/storage';

WebBrowser.maybeCompleteAuthSession();

export interface UserProfile {
  id: number;
  email: string;
  name?: string;
  picture?: string;
}

interface ApiResponse<T> {
  data?: T | null;
}

// SecureStore only accepts alphanumeric keys plus `.`, `-` and `_`.
// Keep the former AsyncStorage key only to migrate sessions saved on web.
const TOKEN_KEY = 'balance.auth.token.v1';
const LEGACY_WEB_TOKEN_KEY = '@balance_auth_token_v1';
const GUEST_KEY = '@balance_guest_v1';

const readToken = async () => Platform.OS === 'web'
  ? (await storage.getItem(TOKEN_KEY)) ?? storage.getItem(LEGACY_WEB_TOKEN_KEY)
  : SecureStore.getItemAsync(TOKEN_KEY);

const writeToken = async (token: string | null) => {
  if (Platform.OS === 'web') {
    if (token) {
      await storage.setItem(TOKEN_KEY, token);
      await storage.removeItem(LEGACY_WEB_TOKEN_KEY);
    } else {
      await Promise.all([
        storage.removeItem(TOKEN_KEY),
        storage.removeItem(LEGACY_WEB_TOKEN_KEY),
      ]);
    }
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
};

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
  const [authToken, setToken] = useState<string | null>(null);

  /** El token vivia solo en memoria: al reiniciar la app la sesion se perdia. */
  const setAuthToken = useCallback((token: string | null) => {
    setToken(token);
    void writeToken(token);
  }, []);

  const checkSession = useCallback(
    async (tokenOverride?: string) => {
      const activeToken = tokenOverride ?? authToken;
      if (!activeToken) {
        setUser(null);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/me`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${activeToken}`,
          },
        });

        if (!response.ok) {
          setUser(null);
          if (response.status === 401) setAuthToken(null);
          return;
        }

        const payload = (await response.json()) as ApiResponse<UserProfile>;
        if (!payload.data) {
          console.warn('La respuesta de perfil no contiene datos de usuario');
          setUser(null);
          return;
        }

        setUser(payload.data);
        setIsGuest(false);
        storage.removeItem(GUEST_KEY);
        // La primera sincronización autenticada usa su namespace propio. Nunca
        // se importan automáticamente documentos del namespace guest.
        syncClient.setNamespace(`user:${payload.data.id}`);
        syncClient.connect(activeToken, `user:${payload.data.id}`);
      } catch (e) {
        console.warn('No se pudo verificar la sesion (sin conexion)', e);
        setUser(null);
      }
    },
    [authToken, setAuthToken]
  );

  /** Rehidrata token y modo invitado antes de decidir a donde va el usuario. */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [savedToken, savedGuest] = await Promise.all([
          readToken(),
          storage.getItem(GUEST_KEY),
        ]);
        if (cancelled) return;

        if (savedToken) {
          setToken(savedToken);
          await checkSession(savedToken);
        } else if (savedGuest === '1') {
          setIsGuest(true);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Solo en el arranque: checkSession se pasa explicitamente el token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enableGuestMode = useCallback(async () => {
    setIsGuest(true);
    setUser(null);
    syncClient.setNamespace('guest');
    await storage.setItem(GUEST_KEY, '1');
    // En modo invitado se leen las plantillas oficiales sin abrir WebSocket
    await fetchOfficialTemplates();
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setIsLoading(true);
    try {
      const discovery = await AuthSession.fetchDiscoveryAsync(OIDC_ISSUER);
      // Cada variante instalable tiene su propio scheme, asi que el callback
      // sale de la config resuelta y no de una constante.
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
        scopes: ['openid', 'profile', 'email'],
        usePKCE: true,
      });
      const result = await request.promptAsync(discovery);
      if (result.type !== 'success' || !result.params.code || !request.codeVerifier) return;
      const tokenResponse = await AuthSession.exchangeCodeAsync({
        clientId: OIDC_MOBILE_CLIENT_ID,
        code: result.params.code,
        redirectUri: redirectUrl,
        extraParams: { code_verifier: request.codeVerifier },
      }, discovery);
      if (!tokenResponse.accessToken) return;
      setAuthToken(tokenResponse.accessToken);
      await checkSession(tokenResponse.accessToken);
    } catch (e) {
      console.error('Fallo el login con Google', e);
    } finally {
      setIsLoading(false);
    }
  }, [checkSession, setAuthToken]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST' });
    } catch {
      // Cerrar sesion localmente aunque el server no responda
    }
    setUser(null);
    setIsGuest(false);
    setAuthToken(null);
    syncClient.disconnect();
    await storage.removeItem(GUEST_KEY);
  }, [setAuthToken]);

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
    [user, isGuest, isLoading, loginWithGoogle, enableGuestMode, logout, setAuthToken, checkSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de un AuthProvider');
  return context;
};
