import { DashboardAuthProvider, useDashboardAuth } from './features/auth/hooks/use-dashboard-auth.tsx';
import { AuthGate } from './features/auth/components/auth-gate/auth-gate.tsx';
import { FoodLog } from './features/food-log/components/food-log/food-log.tsx';
import styles from './app.module.css';

function DashboardRoute() {
  const auth = useDashboardAuth();
  if (auth.isLoading || !auth.user || !auth.accessToken) {
    return <AuthGate loading={auth.isLoading} error={auth.error} onLogin={() => void auth.login()} />;
  }

  return (
    <>
      <div className={styles.account}>
        <span>{auth.user.email}</span>
        <button type="button" onClick={() => void auth.logout()}>logout</button>
      </div>
      <FoodLog />
    </>
  );
}

export function App() {
  return (
    <DashboardAuthProvider>
      <DashboardRoute />
    </DashboardAuthProvider>
  );
}

export default App;
