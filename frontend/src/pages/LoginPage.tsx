import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, DEMO } from '../api.js';
import { useAuth } from '../auth.js';
import { usePageMeta } from '../usePageMeta.js';
import { Brand } from '../components/SiteChrome.js';
import { AutofillDemo, WorksOn } from '../components/illustrations.js';

/** Where to land after signing in, if a guard bounced them here. */
function useReturnTo(): string {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  // Only ever an in-app path — never trust a value that could send someone
  // off-site after authenticating.
  return from && from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
}

export function LoginPage({ mode }: { mode: 'login' | 'signup' }) {
  const { isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const returnTo = useReturnTo();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';

  usePageMeta(
    isSignup ? 'Create your account' : 'Log in',
    isSignup
      ? 'Create a free jobpilot account to autofill applications and track every job you apply to.'
      : 'Log in to your jobpilot tracker.',
    isSignup ? '/signup' : '/login'
  );

  if (isAuthenticated) return <Navigate to={returnTo} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = isSignup
        ? await api.signup(email, password)
        : await api.login(email, password);
      signIn(result.token, remember);
      // New accounts always go through setup; the dashboard guard would only
      // bounce them there anyway, and this avoids the extra redirect.
      navigate(isSignup ? '/onboarding' : returnTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div className="auth-split">
      {/* Left: what the account is for. Hidden on narrow screens, where it
          would push the form below the fold. */}
      <aside className="auth-aside">
        <Brand />

        <div className="auth-pitch">
          <h2>
            Fill it once. <em>Never</em> type it again.
          </h2>
          <p>
            One profile fills every application form, every application logs
            itself, and you find out when a posting comes down.
          </p>
        </div>

        <WorksOn />

        <div className="auth-visual">
          <AutofillDemo />
        </div>
      </aside>

      {/* Right: the form. */}
      <main className="auth-main">
        <div className="auth-panel">
          <Link className="auth-mobile-brand" to="/">
            <Brand />
          </Link>

          <header className="auth-header">
            <h1>{isSignup ? 'Create your account' : 'Log in to jobpilot'}</h1>
            <p>
              {isSignup
                ? 'Free while jobpilot is in early access. No card.'
                : 'Welcome back.'}
            </p>
          </header>

          {DEMO && (
            <p className="demo-hint">
              Demo mode — any email and an 8-character password will sign you in,
              and the tracker is filled with sample data.
            </p>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@example.com"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                minLength={8}
                placeholder={isSignup ? 'At least 8 characters' : ''}
                required
              />
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>
                Keep me signed in
                <small>Off means you are signed out when the tab closes.</small>
              </span>
            </label>

            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}

            <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
              {busy ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="auth-alt">
            {isSignup ? (
              <>
                Already have an account? <Link to="/login">Log in</Link>
              </>
            ) : (
              <>
                Don&rsquo;t have an account? <Link to="/signup">Create one — it&rsquo;s free</Link>
              </>
            )}
          </p>

          <p className="auth-legal">
            By continuing you agree to our <Link to="/terms">Terms</Link> and{' '}
            <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
