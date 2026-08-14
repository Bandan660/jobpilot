import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingSpinner } from '../components/LoadingSpinner.js';
import { Brand } from '../components/SiteChrome.js';
import { usePageMeta } from '../usePageMeta.js';
import {
  applyVerificationCode,
  checkPasswordResetCode,
  completePasswordReset,
  describeAuthError,
} from '../firebase.js';

/**
 * Where Firebase's emailed links land.
 *
 * WHY THIS EXISTS
 *
 * By default those links point at `<project>.firebaseapp.com`, and the
 * verification mail is already fighting for the inbox: it comes from a Google
 * shared subdomain with no relationship to this product, and the link inside
 * it goes somewhere the reader has never heard of. That combination is what a
 * phishing email looks like, and spam filters agree. Pointing the action URL
 * at banapply.com does not fix deliverability on its own — the sender is still
 * Firebase until custom SMTP is configured — but it removes the part of the
 * signal that this page can remove, and it means a user who *does* open the
 * mail stays on a domain they recognise.
 *
 * IT MUST HANDLE EVERY MODE
 *
 * Setting a custom action URL in the Firebase console redirects *all* of that
 * project's email links here, not just the one that prompted it. Handling only
 * `verifyEmail` would silently break password resets — the link would arrive,
 * land on a page that did not understand it, and there would be no way back.
 * So `resetPassword` and `recoverEmail` are handled too.
 *
 * There is no route guard: the whole point is that this works in whichever
 * browser the mail client opened, where nobody is signed in. The `oobCode` is
 * the credential, Firebase validates it server-side, and it is single-use.
 */

type Mode = 'verifyEmail' | 'resetPassword' | 'recoverEmail';

type State =
  | { step: 'working' }
  | { step: 'verified' }
  | { step: 'reset-form'; email: string }
  | { step: 'reset-done' }
  | { step: 'error'; message: string };

export function AuthAction() {
  usePageMeta('Account', undefined, '/auth/action');

  const [params] = useSearchParams();
  const navigate = useNavigate();

  const mode = params.get('mode') as Mode | null;
  const oobCode = params.get('oobCode');

  const [state, setState] = useState<State>({ step: 'working' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mode || !oobCode) {
      setState({
        step: 'error',
        message: 'This link is incomplete. Open the most recent email we sent you.',
      });
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        if (mode === 'verifyEmail' || mode === 'recoverEmail') {
          await applyVerificationCode(oobCode);
          if (!cancelled) setState({ step: 'verified' });
          return;
        }

        if (mode === 'resetPassword') {
          const email = await checkPasswordResetCode(oobCode);
          if (!cancelled) setState({ step: 'reset-form', email });
          return;
        }

        if (!cancelled) {
          setState({ step: 'error', message: 'That link is not one we can handle.' });
        }
      } catch (err) {
        /*
         * Expired and already-used codes both land here, and they are the
         * common case rather than the exception: verification links are opened
         * days later, and people click the same one twice. The message says
         * what to do rather than what went wrong.
         */
        if (!cancelled) {
          setState({
            step: 'error',
            message: describeAuthError(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  async function submitNewPassword(event: FormEvent) {
    event.preventDefault();
    if (!oobCode) return;

    setBusy(true);
    try {
      await completePasswordReset(oobCode, password);
      setState({ step: 'reset-done' });
    } catch (err) {
      setState({ step: 'error', message: describeAuthError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    /*
     * The sign-in shell without its marketing aside. This page is the tail end
     * of an email, not a place to sell anything, and the person reading it is
     * mid-task.
     */
    <main className="auth-main">
      <div className="auth-panel">
        <Link className="auth-mobile-brand" to="/">
          <Brand />
        </Link>

        {state.step === 'working' && <LoadingSpinner label="Checking your link…" />}

        {state.step === 'verified' && (
          <>
            <header className="auth-header">
              <h1>Email confirmed</h1>
              <p>That is the last time we will ask. Sign in and your account is ready.</p>
            </header>
            <button
              className="btn btn-primary"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to sign in
            </button>
          </>
        )}

        {state.step === 'reset-form' && (
          <>
            <header className="auth-header">
              <h1>Choose a new password</h1>
              <p>
                For <strong>{state.email}</strong>.
              </p>
            </header>
            <form onSubmit={submitNewPassword} className="auth-form">
              <label>
                <span>New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                  autoFocus
                />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}

        {state.step === 'reset-done' && (
          <>
            <header className="auth-header">
              <h1>Password changed</h1>
              <p>Sign in with your new password.</p>
            </header>
            <button
              className="btn btn-primary"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to sign in
            </button>
          </>
        )}

        {state.step === 'error' && (
          <>
            <header className="auth-header">
              <h1>That link did not work</h1>
              <p>{state.message}</p>
            </header>
            {/*
              Every failure here is recoverable by asking for a new link, and
              signing in is how both kinds are requested — a password sign-in
              resends verification, and the sign-in screen carries the reset
              link. One destination rather than a decision to make.
            */}
            <Link className="btn btn-primary" to="/login">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
