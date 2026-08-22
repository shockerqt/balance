import styles from './auth-gate.module.css';

interface AuthGateProps {
  loading: boolean;
  error: string | null;
  onLogin: () => void;
}

export function AuthGate({ loading, error, onLogin }: AuthGateProps) {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-live="polite">
        <div className={styles.path}>balance://dashboard</div>
        <h1>{loading ? 'authorizing…' : 'authentication required'}</h1>
        <p>
          {loading
            ? 'Resolving the browser session before private meal data is loaded.'
            : 'Sign in through Balance identity to load your meal log.'}
        </p>
        {error && <div className={styles.error}>{error}</div>}
        {!loading && (
          <button type="button" className={styles.loginButton} onClick={onLogin}>
            login
          </button>
        )}
      </section>
    </main>
  );
}
