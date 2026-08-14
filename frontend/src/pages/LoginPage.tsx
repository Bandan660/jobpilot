import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, DEMO } from '../api.js';
import { useAuth } from '../auth.js';
import { usePageMeta } from '../usePageMeta.js';
import { Brand } from '../components/SiteChrome.js';
import { AutofillDemo, WorksOn } from '../components/illustrations.js';
import {
  describeAuthError,
  firebaseConfigured,
  sendPasswordReset,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from '../firebase.js';

/**
 * Google's mark, inline.
 *
 * Google's branding rules require their own logo on a "Sign in with Google"
 * button rather than a generic icon, and inlining it keeps the button from
 * depending on a network request that would leave it looking broken while it
 * loads.
 */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58z" />
    </svg>
  );
}

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
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';

  /*
   * Clear the last attempt's message when the screen changes purpose.
   *
   * `/login` and `/signup` are the same component with a different prop, so
   * React keeps the instance mounted across the switch and every piece of
   * state with it. A failed sign-in therefore followed the user to the sign-up
   * screen and sat there under "Create your account" — telling someone with no
   * account yet to confirm an email address, about an attempt they had already
   * navigated away from.
   *
   * Email and password deliberately survive: someone who typed an address on
   * one screen and then realised they wanted the other should not have to type
   * it again. It is only the transient state that is stale.
   */
  useEffect(() => {
    setError(null);
    setNotice(null);
    setBusy(false);
  }, [mode]);

  /*
   * Firebase is the identity provider when this build has its config, and the
   * original email/password endpoints when it does not.
   *
   * Both paths end identically — a BanApply session token handed to `signIn` —
   * so nothing downstream knows which was used. Demo mode always takes the
   * legacy path, because it has no API at all and no Firebase project.
   */
  const useFirebase = firebaseConfigured() && !DEMO;

  usePageMeta(
    isSignup ? 'Create your account' : 'Log in',
    isSignup
      ? 'Create a free BanApply account to autofill applications and track every job you apply to.'
      : 'Log in to your BanApply tracker.',
    isSignup ? '/signup' : '/login'
  );

  if (isAuthenticated) return <Navigate to={returnTo} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      let token: string;

      if (useFirebase) {
        const idToken = isSignup
          ? await signUpWithPassword(email, password)
          : await signInWithPassword(email, password);
        token = (await api.firebaseExchange(idToken)).token;
      } else {
        const result = isSignup
          ? await api.signup(email, password)
          : await api.login(email, password);
        token = result.token;
      }

      signIn(token, remember);
      // New accounts always go through setup; the dashboard guard would only
      // bounce them there anyway, and this avoids the extra redirect.
      navigate(isSignup ? '/onboarding' : returnTo, { replace: true });
    } catch (err) {
      setError(authMessage(err));
      setBusy(false);
    }
  }

  /**
   * Firebase codes get translated; anything else is already ours.
   *
   * `describeAuthError` returns '' for a popup the user closed themselves —
   * that is not an error and showing one for it is how a UI feels broken.
   */
  function authMessage(err: unknown): string {
    const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
    if (code.startsWith('auth/')) return describeAuthError(err);
    return err instanceof Error ? err.message : 'Something went wrong';
  }

  async function handleGoogle() {
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      const idToken = await signInWithGoogle();
      const result = await api.firebaseExchange(idToken);
      signIn(result.token, remember);
      /*
       * Google sign-in cannot tell a new account from a returning one — the
       * exchange creates the row if it is missing, and either way this is the
       * same call. Sending everyone to onboarding would be wrong for returning
       * users, so the dashboard's own guard decides: it bounces anyone who has
       * not finished setup, which is exactly the check needed here.
       */
      navigate(returnTo, { replace: true });
    } catch (err) {
      const message = authMessage(err);
      if (message) setError(message);
      setBusy(false);
    }
  }

  async function handleForgot() {
    setError(null);
    setNotice(null);

    if (!email.trim()) {
      setError('Enter your email address first, then press this again.');
      return;
    }

    await sendPasswordReset(email.trim());
    // The same confirmation whether or not that address has an account: the
    // alternative is an endpoint that reports who is registered here.
    setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`);
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
            <h1>{isSignup ? 'Create your account' : 'Log in to BanApply'}</h1>
            <p>
              {isSignup
                ? 'Free while BanApply is in early access. No card.'
                : 'Welcome back.'}
            </p>
          </header>

          {DEMO && (
            <p className="demo-hint">
              Demo mode — any email and an 8-character password will sign you in,
              and the tracker is filled with sample data.
            </p>
          )}

          {useFirebase && (
            <>
              <button
                type="button"
                className="btn btn-google"
                onClick={() => void handleGoogle()}
                disabled={busy}
              >
                <GoogleMark />
                {isSignup ? 'Sign up with Google' : 'Continue with Google'}
              </button>

              <div className="auth-divider">
                <span>or</span>
              </div>
            </>
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

            {!isSignup && useFirebase && (
              <button type="button" className="link-button auth-forgot" onClick={() => void handleForgot()}>
                Forgot your password?
              </button>
            )}

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

            {notice && (
              <p className="notice-text" role="status">
                {notice}
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
