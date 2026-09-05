import { createContext, useContext, type ReactNode } from 'react';
import { useBrowserAuth, type BrowserAuthState } from '../../../hooks/use-browser-auth.ts';

const DashboardAuthContext = createContext<BrowserAuthState | null>(null);

export function DashboardAuthProvider({ children }: { children: ReactNode }) {
  const auth = useBrowserAuth();
  return <DashboardAuthContext.Provider value={auth}>{children}</DashboardAuthContext.Provider>;
}

export function useDashboardAuth(): BrowserAuthState {
  const auth = useContext(DashboardAuthContext);
  if (!auth) throw new Error('useDashboardAuth must be used inside DashboardAuthProvider');
  return auth;
}
