import React, { createContext, useContext, useState, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { syncClient } from '@/services/rxdb/sync-client';
import { fetchOfficialTemplates } from '@/services/rxdb/official-templates';

WebBrowser.maybeCompleteAuthSession();

export interface UserProfile {
  id: number;
  email: String;
  name?: string;
  picture?: string;
}

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

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://144.22.47.0:8080';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [authToken, setAuthToken] = useState<string | null>(null);

  const checkSession = async (tokenOverride?: string) => {
    try {
      const activeToken = tokenOverride || authToken;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (activeToken) {
        headers['Authorization'] = `Bearer ${activeToken}`;
      }
      const response = await fetch(`${API_BASE_URL}/me`, {
        method: 'GET',
        headers,
      });
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setIsGuest(false);
        // Post-Login: Connect WebSocket sync to push local guest logs & templates to server
        syncClient.connect();
      } else {
        setUser(null);
      }
    } catch (e) {
      console.warn('Session check failed or offline', e);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  const enableGuestMode = async () => {
    setIsGuest(true);
    setUser(null);
    // In Guest Mode: Fetch official immutable templates without opening WebSocket
    const templates = await fetchOfficialTemplates();
    console.log('[Guest Mode] Loaded official templates:', templates.length);
  };

  const loginWithGoogle = async () => {
    setIsLoading(true);
    try {
      const redirectUrl = 'balance://auth-callback';
      const authUrl = `${API_BASE_URL}/auth/google?redirect_uri=${encodeURIComponent(redirectUrl)}`;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

      if (result.type === 'success' && result.url) {
        console.log('[Auth] Google OAuth redirect success:', result.url);
        let extractedToken: string | undefined;
        try {
          const urlObj = new URL(result.url);
          extractedToken = urlObj.searchParams.get('token') || undefined;
        } catch {
          const match = result.url.match(/[?&]token=([^&]+)/);
          if (match) extractedToken = match[1];
        }
        if (extractedToken) {
          setAuthToken(extractedToken);
        }
        await checkSession(extractedToken);
      }
    } catch (e) {
      console.error('[Auth] Error in Google login flow', e);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: 'GET' });
    } catch (e) {
      // Ignore
    }
    setUser(null);
    setIsGuest(false);
    setAuthToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isGuest,
        isLoading,
        loginWithGoogle,
        enableGuestMode,
        logout,
        setAuthToken,
        checkSession,
      }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
