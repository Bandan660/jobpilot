import type { Auth, UserCredential } from 'firebase/auth';

/**
 * Firebase, loaded only when someone is actually signing in.
 *
 * Everything here is behind a dynamic import for one reason: the auth SDK is
 * large, and this site is held to a Lighthouse budget that a static import
 * would spend on visitors who never sign in. The auth routes are already
 * `lazy()` in App.tsx, so the chunk lands with the login page and never on a
 * marketing page.
 *
 * It also keeps the SDK away from the prerenderer. `renderToString` runs in
 * Node, where Firebase's browser build has no `window` to initialise against —
 * an import at module scope in anything on a public route would break the
 * build rather than the page, which at least fails loudly, but only after
 * someone has spent a while wondering why.
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/**
 * Read from Vite env at build time.
 *
 * None of these are secrets — a Firebase web config ships in every client that
 * uses it, and Google's model is that the API key identifies the project
 * rather than authorising anything. What protects the data is the ID token
 * check in the Worker and Firebase's own rules, not hiding this.
 */
export const firebaseConfig: FirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
};

/** Whether sign-in can work at all here. Lets the UI hide what cannot function. */
export function firebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
}

/** One app and one Auth instance per page, created on first use. */
let authPromise: Promise<Auth> | null = null;

async function getFirebaseAuth(): Promise<Auth> {
  if (!firebaseConfigured()) {
    throw new Error('Sign-in is not configured for this build.');
  }

  authPromise ??= (async () => {
    const [{ initializeApp, getApps, getApp }, { getAuth, setPersistence, browserLocalPersistence }] =
      await Promise.all([import('firebase/app'), import('firebase/auth')]);

    // getApps() first: React strict mode mounts twice in development, and
    // initializeApp on an existing name throws rather than returning it.
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);

    /*
     * Local persistence, so a refresh does not sign the user out.
     *
     * The jobpilot session is a separate 30-day token — this only governs
     * whether Firebase can mint a fresh ID token without another prompt, which
     * matters for password reset and for re-linking later.
     */
    await setPersistence(auth, browserLocalPersistence);
    return auth;
  })();

  return authPromise;
}

/** The ID token to hand to POST /api/auth/firebase. */
async function idTokenFrom(credential: UserCredential): Promise<string> {
  return credential.user.getIdToken();
}

export async function signInWithGoogle(): Promise<string> {
  const auth = await getFirebaseAuth();
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');

  const provider = new GoogleAuthProvider();
  /*
   * Always ask which account.
   *
   * Without this, Google silently reuses the only signed-in session, which is
   * wrong for a job-search tool: people keep a personal and a college or work
   * account, and the one they want here is frequently not the one their
   * browser defaults to. Signing in as the wrong account creates a second
   * jobpilot user and splits their tracked applications.
   */
  provider.setCustomParameters({ prompt: 'select_account' });

  return idTokenFrom(await signInWithPopup(auth, provider));
}

/**
 * Send the "confirm your address" email.
 *
 * Firebase does not do this on its own. Creating an account with
 * `createUserWithEmailAndPassword` sends nothing at all — the address stays
 * unverified until the app asks for a link — and the API now refuses to trade
 * an unverified token for a session, because an unverified address proves
 * possession to nobody and was a route to taking over an existing account.
 *
 * So the two halves have to agree: the moment sign-up demands verification,
 * sign-up has to send the thing being demanded. Without this, an
 * email/password account was created, refused, and had no way of ever
 * passing — no email, no button, nothing to click.
 *
 * Failure is swallowed. The account exists either way, the user is being told
 * to check their email either way, and the resend path below covers a link
 * that never arrived. Turning a mail-delivery hiccup into a failed sign-up
 * would be the worse outcome.
 */
async function requestVerification(user: UserCredential['user']): Promise<void> {
  try {
    const { sendEmailVerification } = await import('firebase/auth');
    await sendEmailVerification(user);
  } catch {
    /* Resend covers it. */
  }
}

export async function signUpWithPassword(email: string, password: string): Promise<string> {
  const auth = await getFirebaseAuth();
  const { createUserWithEmailAndPassword } = await import('firebase/auth');

  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await requestVerification(credential.user);

  return idTokenFrom(credential);
}

export async function signInWithPassword(email: string, password: string): Promise<string> {
  const auth = await getFirebaseAuth();
  const { signInWithEmailAndPassword } = await import('firebase/auth');

  const credential = await signInWithEmailAndPassword(auth, email, password);

  /*
   * Signing in unverified means the last link was never opened — often because
   * it was never sent, which is every account created before verification was
   * required. Send a fresh one *now*, so the message the API is about to
   * return ("check your email") describes something that just happened rather
   * than something that never did.
   */
  if (!credential.user.emailVerified) {
    await requestVerification(credential.user);
  }

  return idTokenFrom(credential);
}

/*
 * There is deliberately no separate "resend" button.
 *
 * Every password sign-in already sends a fresh link when the address is still
 * unverified, so pressing sign-in again *is* the resend — one control that
 * does the obvious thing, rather than two that need explaining. An exported
 * helper nothing called would also be exactly the dead optional member this
 * codebase has been bitten by before.
 */

/**
 * Send a reset email. Resolves either way.
 *
 * Firebase reports `auth/user-not-found` for an unknown address, and passing
 * that to the user turns this into a way to test whether someone has an
 * account. The caller shows the same confirmation regardless.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const auth = await getFirebaseAuth();
  const { sendPasswordResetEmail } = await import('firebase/auth');

  try {
    await sendPasswordResetEmail(auth, email);
  } catch {
    /* Deliberately silent — see above. */
  }
}

/**
 * Apply a `verifyEmail` link.
 *
 * `oobCode` is the one-time code from the emailed URL. Firebase checks it
 * server-side, so nothing here needs the user to be signed in — which matters,
 * because the link is usually opened in whichever browser their mail client
 * prefers rather than the one they signed up in.
 */
export async function applyVerificationCode(oobCode: string): Promise<void> {
  const auth = await getFirebaseAuth();
  const { applyActionCode } = await import('firebase/auth');
  await applyActionCode(auth, oobCode);
}

/**
 * Check a `resetPassword` link and return the address it belongs to.
 *
 * Shown on the form, because a reset link arriving in a shared or forwarded
 * inbox should say which account it is about before anyone types a new
 * password for it.
 */
export async function checkPasswordResetCode(oobCode: string): Promise<string> {
  const auth = await getFirebaseAuth();
  const { verifyPasswordResetCode } = await import('firebase/auth');
  return verifyPasswordResetCode(auth, oobCode);
}

/** Complete a password reset. The code is single-use and dies with it. */
export async function completePasswordReset(oobCode: string, password: string): Promise<void> {
  const auth = await getFirebaseAuth();
  const { confirmPasswordReset } = await import('firebase/auth');
  await confirmPasswordReset(auth, oobCode, password);
}

/**
 * Firebase error codes, in words a person can act on.
 *
 * The raw messages are written for developers ("Firebase: Error
 * (auth/invalid-credential).") and leak the SDK into the UI. Anything
 * unrecognised falls through to a generic line rather than being shown raw.
 */
export function describeAuthError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/email-already-in-use':
      return 'An account with that email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Pick a longer password — at least 8 characters.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      // One message for all three: which of them it was is exactly what an
      // attacker probing for registered addresses wants to know.
      return 'Invalid email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow popups for this site and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorised in the Firebase console yet.';
    /*
     * Emailed links, not sign-in attempts.
     *
     * These reach the user through `/auth/action`, and the generic fallback
     * below — "could not sign you in" — is both wrong and useless there: they
     * were not signing in, and it does not say the one thing that helps, which
     * is that the link is dead and a fresh one is a sign-in away. Both codes
     * get the same wording because the distinction between "expired" and
     * "already used" changes nothing about what to do next.
     */
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'This link has expired or has already been used. Sign in to get a new one.';
    case 'auth/user-disabled':
      return 'That account has been disabled. Get in touch if you think that is wrong.';
    default:
      return 'Could not sign you in. Try again in a moment.';
  }
}
