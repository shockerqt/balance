import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { syncClient } from '@/services/sync/sync-client';
import { fetchOfficialTemplates } from '@/services/sync/official-templates';
import { API_BASE_URL } from '@/services/config';
import { storage } from '@/services/storage';

WebBrowser.maybeCompleteAuthSession();

export interface UserProfile {
  id: number;
  email: string;
  name?: string;
  picture?: string;
}

const TOKEN_KEY = '@balance_auth_token_v1';
const GUEST_KEY = '@balance_guest_v1';

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
    if (token) storage.setItem(TOKEN_KEY, token);
    else storage.removeItem(TOKEN_KEY);
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

        setUser(await response.json());
        setIsGuest(false);
        storage.removeItem(GUEST_KEY);
        // Tras autenticar, sube los registros locales del modo invitado
        syncClient.connect();
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
          storage.getItem(TOKEN_KEY),
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
    await storage.setItem(GUEST_KEY, '1');
    // En modo invitado se leen las plantillas oficiales sin abrir WebSocket
    await fetchOfficialTemplates();
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setIsLoading(true);
    try {
      const redirectUrl = 'balance://auth-callback';
      const authUrl = `${API_BASE_URL}/auth/google?redirect_uri=${encodeURIComponent(redirectUrl)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

      if (result.type !== 'success' || !result.url) return;

      let token: string | undefined;
      try {
        token = new URL(result.url).searchParams.get('token') ?? undefined;
      } catch {
        token = result.url.match(/[?&]token=([^&]+)/)?.[1];
      }

      if (token) setAuthToken(token);
      await checkSession(token);
    } catch (e) {
      console.error('Fallo el login con Google', e);
    } finally {
      setIsLoading(false);
    }
  }, [checkSession, setAuthToken]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: 'GET' });
    } catch {
      // Cerrar sesion localmente aunque el server no responda
    }
    setUser(null);
    setIsGuest(false);
    setAuthToken(null);
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
