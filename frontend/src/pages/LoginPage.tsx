import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, DEMO } from '../api.js';
import { useAuth } from '../auth.js';

export function LoginPage({ mode }: { mode: 'login' | 'signup' }) {
  const { isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result =
        mode === 'signup' ? await api.signup(email, password) : await api.login(email, password);
      signIn(result.token);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <p>
          {mode === 'signup'
            ? 'One account links the extension to your tracker.'
            : 'Sign in to open your tracker.'}
        </p>

        {DEMO && (
          <p className="demo-hint">
            Demo mode — any email and password will sign you in, and the tracker is filled with
            sample data.
          </p>
        )}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={8}
            required
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>

        <p className="auth-footer">
          {mode === 'signup' ? (
            <>
              Already have an account? <Link to="/login">Sign in</Link>
            </>
          ) : (
            <>
              No account yet? <Link to="/signup">Create one</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
