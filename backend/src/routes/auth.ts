import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthResponse } from '@jobpilot/shared';
import { cleanSecret, createDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { verifyFirebaseToken } from '../auth/firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { isAdmin } from '../middleware/admin.js';
import type { AppContext } from '../env.js';

const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const authRoutes = new Hono<AppContext>();

authRoutes.post('/signup', async (c) => {
  const parsed = credentials.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const { email, password } = parsed.data;
  const db = createDb(c.env);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  if (existing.length > 0) {
    throw new HTTPException(409, { message: 'An account with that email already exists' });
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ email, passwordHash }).returning();

  const token = await signToken(user.id, cleanSecret(c.env.JWT_SECRET));
  const body: AuthResponse = {
    token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() },
  };
  return c.json(body, 201);
});

authRoutes.post('/login', async (c) => {
  const parsed = credentials.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid email or password' });
  }

  const { email, password } = parsed.data;
  const db = createDb(c.env);

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  // Same message and roughly the same work whether the account exists or not,
  // so this endpoint cannot be used to enumerate registered emails.
  /*
   * `user.passwordHash` is nullable since Firebase arrived. An account created
   * by Google sign-in has none, and this endpoint must refuse it rather than
   * hand a null to `verifyPassword` — the whole point of the column being
   * nullable is that "no local password" means "cannot log in this way", not
   * "no password required".
   */
  const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    throw new HTTPException(401, { message: 'Invalid email or password' });
  }

  const token = await signToken(user.id, cleanSecret(c.env.JWT_SECRET));
  const body: AuthResponse = {
    token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() },
  };
  return c.json(body);
});

/**
 * Who the caller is and what they may reach.
 *
 * Exists so the dashboard can decide whether to render the admin link without
 * calling an endpoint it may not be allowed to call — a 403 in the console on
 * every page load for every normal user is noise that trains people to ignore
 * the console.
 *
 * `isAdmin: false` for everyone who is not on the allowlist. That is not a
 * secret worth keeping: it tells a signed-in user only that an admin surface
 * exists, which the marketing site does not hide either, and the surface
 * itself is guarded server-side regardless of what this says.
 */
authRoutes.get('/session', requireAuth, async (c) => {
  const userId = c.get('userId');
  return c.json({ userId, isAdmin: await isAdmin(c.env, userId) });
});

/**
 * Exchange a Firebase ID token for a jobpilot session.
 *
 * WHY EXCHANGE RATHER THAN VERIFY PER REQUEST
 *
 * A Firebase ID token lasts one hour and is renewed with a refresh token. The
 * extension holds its session in chrome.storage.local with no refresh flow,
 * and `jwt.ts` explains why that is deliberate: a short expiry means being
 * signed out mid-application, which is the most costly moment to interrupt
 * anyone. Verifying Firebase tokens on every request would force that refresh
 * machinery into the extension, the content script and the background worker.
 *
 * Exchanging once keeps Firebase at the edge of the system. Everything past
 * this line — `requireAuth`, every route, the admin allowlist, every foreign
 * key — still deals in the 30-day jobpilot token and the local user id, and
 * did not change when this was added.
 *
 * MATCHING AN EXISTING ACCOUNT
 *
 * By uid first, then by email. The uid is the stable identity; the email match
 * exists so an account created before Firebase, or created by a different
 * sign-in method with the same address, is adopted rather than duplicated —
 * Firebase itself treats one email as one account by default, and a second row
 * here would silently split someone's tracked applications in two.
 */
authRoutes.post('/firebase', async (c) => {
  const projectId = (c.env.FIREBASE_PROJECT_ID ?? '').trim();
  if (!projectId) {
    throw new HTTPException(503, { message: 'Google sign-in is not configured' });
  }

  const body = await c.req.json().catch(() => null);
  const idToken = typeof body?.idToken === 'string' ? body.idToken : '';

  const identity = await verifyFirebaseToken(idToken, projectId);
  if (!identity) {
    throw new HTTPException(401, { message: 'Invalid sign-in token' });
  }

  const db = createDb(c.env);

  const [byUid] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, identity.uid))
    .limit(1);

  let user = byUid;

  if (!user) {
    const [byEmail] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${identity.email})`)
      .limit(1);

    if (byEmail) {
      // Adopt the existing row. Claiming the uid now means the next sign-in
      // takes the cheaper path above and cannot drift onto a second account.
      const [linked] = await db
        .update(users)
        .set({ firebaseUid: identity.uid })
        .where(eq(users.id, byEmail.id))
        .returning();
      user = linked;
    } else {
      const [created] = await db
        .insert(users)
        .values({ email: identity.email, firebaseUid: identity.uid })
        .returning();
      user = created;
    }
  }

  if (!user) {
    throw new HTTPException(500, { message: 'Could not create an account' });
  }

  const token = await signToken(user.id, cleanSecret(c.env.JWT_SECRET));
  const authBody: AuthResponse = {
    token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() },
  };
  return c.json(authBody);
});
