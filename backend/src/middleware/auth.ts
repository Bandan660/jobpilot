import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { verifyToken } from '../auth/jwt.js';
import { cleanSecret, createDb } from '../db/client.js';
import { users } from '../db/schema.js';
import type { AppContext } from '../env.js';

/**
 * Requires a `Authorization: Bearer <jwt>` header and puts the user id on the
 * context as `userId`. Every route past this point can trust it.
 *
 * WHY THIS READS THE DATABASE
 *
 * A signature check alone cannot un-issue anything. Tokens here last 30 days —
 * `auth/jwt.ts` sets out why, and being signed out mid-application really is
 * the worst moment to interrupt someone — but a long life with no way to end
 * one early means a leaked token is simply valid for a month, and signing out
 * only deletes the client's copy of it.
 *
 * So every request checks the token against `users.tokensValidFrom`. One
 * UPDATE to that column ends every session for that account: the sign-out
 * route uses it, and it is the lever to pull if a token is ever exposed.
 *
 * The cost is one indexed primary-key lookup per request, against a Postgres
 * connection this handler was going to open anyway on all but a couple of
 * routes. Worth it for a revocation story that exists.
 */
export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new HTTPException(401, { message: 'Missing bearer token' });
  }

  // Same BOM/whitespace defence as the database URL — a signing key that
  // differs by one invisible character fails in a way nothing explains.
  const claims = await verifyToken(token, cleanSecret(c.env.JWT_SECRET));
  if (!claims) {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  const db = createDb(c.env);
  const [user] = await db
    .select({ tokensValidFrom: users.tokensValidFrom })
    .from(users)
    .where(eq(users.id, claims.userId))
    .limit(1);

  // A token whose subject no longer exists is not a valid session. Deleting an
  // account must not leave a month of working credentials behind it.
  if (!user) {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  /*
   * `issuedAt === null` is treated as revoked whenever a cutoff exists. A token
   * with no `iat` cannot be placed relative to the cutoff, and "cannot tell"
   * has to resolve to "no" for a revocation check to mean anything. Every token
   * this codebase has ever signed carries one, so this rejects nothing real.
   */
  const issuedAt = claims.issuedAt;
  if (issuedAt === null || issuedAt < user.tokensValidFrom.getTime()) {
    throw new HTTPException(401, { message: 'Session ended. Please sign in again.' });
  }

  c.set('userId', claims.userId);
  await next();
});
