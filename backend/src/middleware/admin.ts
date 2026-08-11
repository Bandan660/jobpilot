import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { adminEmails, type AppContext } from '../env.js';

/**
 * Admin is an allowlist of email addresses in a Worker secret, not a column.
 *
 * The point is that there is nothing in the database to escalate. A `role`
 * column makes "become an admin" a single UPDATE away for anything that ever
 * gets write access to the users table — an injection, a leaked connection
 * string, a bad migration. An allowlist read from the environment cannot be
 * changed by anything the API can be tricked into doing; changing who is an
 * admin means a deploy.
 *
 * Runs after `requireAuth`, never instead of it: this decides *whether* an
 * authenticated user is an admin and relies on the token check having already
 * established *which* user they are.
 */
export const requireAdmin = createMiddleware<AppContext>(async (c, next) => {
  const allowed = adminEmails(c.env);

  /*
   * An unset ADMIN_EMAILS grants nobody. It would be easy to read an empty
   * allowlist as "not configured, so don't enforce" — which is how a
   * misconfigured deploy silently opens the admin surface to every account.
   * Closed is the only safe reading of absent configuration.
   */
  if (allowed.length === 0) {
    throw new HTTPException(403, { message: 'Not authorised' });
  }

  const db = createDb(c.env);
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, c.get('userId')))
    .limit(1);

  // Case-insensitive, because the users table indexes email that way and an
  // admin who signed up as Bandan@… would otherwise be locked out of their own
  // dashboard for a reason nothing on screen explains.
  if (!user || !allowed.includes(user.email.trim().toLowerCase())) {
    /*
     * 403 and the same wording whether the account exists, is signed in but
     * not an admin, or is an admin whose email was removed. A response that
     * distinguishes them is an oracle for probing who the admins are.
     */
    throw new HTTPException(403, { message: 'Not authorised' });
  }

  await next();
});

/** Whether the signed-in user is an admin, for surfaces that show or hide a link. */
export async function isAdmin(
  env: AppContext['Bindings'],
  userId: string
): Promise<boolean> {
  const allowed = adminEmails(env);
  if (allowed.length === 0) return false;

  const db = createDb(env);
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return Boolean(user && allowed.includes(user.email.trim().toLowerCase()));
}
