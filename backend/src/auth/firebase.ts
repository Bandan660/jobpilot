import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Verifying a Firebase ID token, without the Admin SDK.
 *
 * The Admin SDK is a Node library that does not run on Workers, and it is not
 * needed: a Firebase ID token is an ordinary RS256 JWT signed by Google, and
 * `jose` verifies those. What the SDK adds is the checks below, which are the
 * whole of the security here and are worth stating rather than trusting a
 * dependency to remember.
 *
 * WHAT IS CHECKED, AND WHY EACH ONE MATTERS
 *
 * - Signature, against Google's published keys. Without it the token is a
 *   string the client made up.
 * - `aud` equals the project id. A token minted for *any other Firebase
 *   project* is a valid Google-signed JWT; without this check, anyone with a
 *   free Firebase project could mint tokens this API accepts.
 * - `iss` is securetoken.google.com/<project>. Same reasoning from the other
 *   direction.
 * - `sub` is a non-empty string. It is the Firebase uid, and it becomes the
 *   identity everything downstream is keyed to.
 * - Expiry, which `jwtVerify` enforces.
 *
 * Firebase ID tokens last one hour. That short life is exactly why this is an
 * exchange rather than a per-request check — see routes/auth.ts.
 */

/**
 * Google's signing keys, fetched once and cached by `jose`.
 *
 * Module-level so the cache survives between requests on a warm isolate.
 * Google rotates these, and `createRemoteJWKSet` refetches on an unknown key
 * id, so rotation needs no handling here.
 */
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export interface FirebaseIdentity {
  /** Firebase uid. Stable for the life of the account. */
  uid: string;
  email: string;
  emailVerified: boolean;
  /** 'password', 'google.com', … — recorded for support, not for access. */
  provider: string | null;
}

/**
 * Returns the identity in the token, or null for anything not provably valid.
 *
 * Null rather than throwing, and one null for every failure: the caller turns
 * it into a single 401, so a malformed token, a token for another project and
 * an expired one are indistinguishable from outside. Distinguishing them tells
 * an attacker which part of their forgery to fix.
 */
export async function verifyFirebaseToken(
  token: string,
  projectId: string
): Promise<FirebaseIdentity | null> {
  if (!token || !projectId) return null;

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    });

    const uid = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';

    /*
     * No email, no account.
     *
     * Every user row here is keyed by email — the admin allowlist matches on
     * it, and duplicate detection is per user — and Firebase can issue tokens
     * for sign-in methods that carry none (anonymous, phone). Those are not
     * enabled, but "not enabled today" is not a guarantee, and a row with an
     * empty email would collide with the next one on the unique index.
     */
    if (!uid || !email) return null;

    const firebase = payload.firebase as { sign_in_provider?: string } | undefined;

    return {
      uid,
      email,
      emailVerified: payload.email_verified === true,
      provider: firebase?.sign_in_provider ?? null,
    };
  } catch {
    return null;
  }
}
