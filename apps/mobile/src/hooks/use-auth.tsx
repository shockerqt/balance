import React, { createContext, useContext, useState, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { syncClient } from '@/services/rxdb/sync-client';

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
  isLoading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://144.22.47.0:8080';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const checkSession = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/me`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        // Connect RxDB WebSocket replication
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

  const loginWithGoogle = async () => {
    setIsLoading(true);
    try {
      const authUrl = `${API_BASE_URL}/auth/google`;
      const redirectUrl = 'balance://auth-callback';

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);

      if (result.type === 'success') {
        console.log('[Auth] Google OAuth redirect success');
        await checkSession();
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
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        loginWithGoogle,
        logout,
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
