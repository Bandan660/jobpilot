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

export async function signUpWithPassword(email: string, password: string): Promise<string> {
  const auth = await getFirebaseAuth();
  const { createUserWithEmailAndPassword } = await import('firebase/auth');
  return idTokenFrom(await createUserWithEmailAndPassword(auth, email, password));
}

export async function signInWithPassword(email: string, password: string): Promise<string> {
  const auth = await getFirebaseAuth();
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  return idTokenFrom(await signInWithEmailAndPassword(auth, email, password));
}

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
    default:
      return 'Could not sign you in. Try again in a moment.';
  }
}
