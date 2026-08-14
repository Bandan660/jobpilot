import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'jobpilot';
const AUDIENCE = 'jobpilot-client';

/**
 * 30 days. The extension holds this token in chrome.storage.local and has no
 * refresh flow yet, so a short expiry would mean re-login mid-application --
 * exactly when interrupting the user is most costly.
 */
const TTL = '30d';

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(TTL)
    .sign(key(secret));
}

export interface VerifiedToken {
  userId: string;
  /** When this token was issued, in ms. Checked against `users.tokensValidFrom`. */
  issuedAt: number | null;
}

/** Returns the claims, or null for any invalid/expired/malformed token. */
export async function verifyToken(token: string, secret: string): Promise<VerifiedToken | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (typeof payload.sub !== 'string') return null;

    return {
      userId: payload.sub,
      // `setIssuedAt` always writes one, but a token minted before that did not
      // have to. Null here is treated as "older than any revocation" by the
      // caller, which is the safe reading.
      issuedAt: typeof payload.iat === 'number' ? payload.iat * 1000 : null,
    };
  } catch {
    return null;
  }
}
