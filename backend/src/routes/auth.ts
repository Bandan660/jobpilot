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
import { rateLimit, type RateLimitScope } from '../middleware/rateLimit.js';
import type { AppContext } from '../env.js';

const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

/**
 * A hash no password produces, for the "no such account" branch of login.
 *
 * Shaped exactly like a real stored hash — same prefix, same iteration count,
 * a 16-byte salt and a 32-byte digest — so `verifyPassword` runs its full
 * PBKDF2 derivation against it and takes the time it takes. The digest is all
 * zeroes, which no derivation returns, so the comparison always fails.
 */
const DECOY_HASH = `pbkdf2-sha256$100000$${btoa('\0'.repeat(16))}$${btoa('\0'.repeat(32))}`;

/**
 * The revocation cutoff a brand-new account starts with.
 *
 * NOT `now()`, which is what the column defaults to and what this exists to
 * override. `tokensValidFrom` means "sessions issued before this instant are
 * refused", and a fresh row has no sessions to refuse — but `requireAuth`
 * compares it against the token's `iat`, and `iat` is **whole seconds** while
 * Postgres `now()` carries microseconds. A row created at 12:00:00.734 is
 * handed a token stamped 12:00:00.000 — earlier than the account’s own
 * cutoff — so the first request after signing up came back 401.
 *
 * It presented as "session expired" on the dashboard immediately after a
 * successful sign-in, and only ever to people creating an account: by anyone’s
 * second sign-in the cutoff is minutes in the past. Roughly 97% of new
 * accounts hit it. The survivors were the ones whose insert happened to land
 * in the last few milliseconds of a second, so signing crossed the boundary
 * and the truncation rounded the other way.
 *
 * The epoch says what is actually true: nothing has been revoked here yet.
 * No amount of rounding can make a token look older than that.
 */
const NEVER_REVOKED = new Date(0);

export const authRoutes = new Hono<AppContext>();

/*
 * Keyed by IP *and* email, not IP alone.
 *
 * Address-only buckets punish everyone behind one NAT — a college, an office,
 * a mobile carrier — for one person's typo, and an attacker spreading guesses
 * across many accounts from one address is exactly the case that needs
 * catching. Including the email means one attacker cannot lock a whole network
 * out of sign-in, and cannot get more than ten guesses at any one account.
 */
const perEmail: RateLimitScope = async (c) => {
  const body = (await c.json()) as { email?: unknown } | null;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
};

authRoutes.post('/signup', rateLimit('AUTH_LIMITER', perEmail), async (c) => {
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
  const [user] = await db.insert(users)
    .values({ email, passwordHash, tokensValidFrom: NEVER_REVOKED })
    .returning();

  const token = await signToken(user.id, cleanSecret(c.env.JWT_SECRET));
  const body: AuthResponse = {
    token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() },
  };
  return c.json(body, 201);
});

authRoutes.post('/login', rateLimit('AUTH_LIMITER', perEmail), async (c) => {
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

  /*
   * The same message *and the same work* whether the account exists or not.
   *
   * The message was already identical; the work was not. `user?.passwordHash ?
   * await verifyPassword(…) : false` skipped 100,000 PBKDF2 iterations
   * entirely for an unknown address, and that is not a subtle difference — it
   * is the dominant cost of this endpoint and trivially measurable from
   * outside. An attacker times a batch of addresses and learns which ones have
   * accounts, which is exactly what the shared message exists to prevent.
   *
   * So a miss verifies against a decoy hash instead. Same algorithm, same
   * iteration count, same rough duration, and it can never succeed: nothing
   * hashes to a salt-and-digest of zeroes.
   *
   * `user.passwordHash` is nullable since Firebase arrived. An account created
   * by Google sign-in has none, and this endpoint must refuse it rather than
   * hand a null to `verifyPassword` — the whole point of the column being
   * nullable is that "no local password" means "cannot log in this way", not
   * "no password required". Those accounts take the decoy path too, so they
   * are not distinguishable by timing either.
   */
  const ok = await verifyPassword(password, user?.passwordHash ?? DECOY_HASH);
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
 * End every session for this account.
 *
 * Signing out used to be entirely client-side — delete the local copy of the
 * token and hope. The token itself stayed valid for the rest of its 30 days,
 * so "sign out" on a shared or stolen machine did nothing an attacker holding
 * the token would notice.
 *
 * Moving the cutoff forward invalidates every token issued before now, on
 * every device. That is deliberately broader than "this browser": the moment
 * anyone reaches for sign-out for a security reason, the other copies are
 * exactly what they want gone. Signing in again is one press.
 *
 * A second granted after the last token was issued, because `iat` has
 * one-second resolution: a token minted in the same second as the cutoff would
 * otherwise survive its own revocation.
 */
authRoutes.post('/logout', requireAuth, async (c) => {
  const db = createDb(c.env);
  await db
    .update(users)
    .set({ tokensValidFrom: new Date(Date.now() + 1000) })
    .where(eq(users.id, c.get('userId')));

  return c.json({ ok: true });
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
authRoutes.post('/firebase', rateLimit('AUTH_LIMITER'), async (c) => {
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

  /*
   * An unverified email proves possession of the address to nobody.
   *
   * This is the whole security of the match below. Firebase signup is
   * client-side and self-service, and it issues a fully valid ID token — right
   * signature, right `aud`, right `iss` — the instant an email/password account
   * is created, before the address is confirmed. So without this check:
   *
   *   1. Attacker registers victim@example.com at *our* Firebase project and
   *      never opens the verification email.
   *   2. `verifyFirebaseToken` accepts the token, because it is genuine.
   *   3. The email lookup below finds the victim's existing account and links
   *      the attacker's uid to it — permanently, so every later sign-in takes
   *      the uid path — and returns a 30-day session for the victim's userId.
   *
   * That is a full account takeover knowing only an email address. The flag was
   * being read off the token and thrown away; it is now the gate.
   *
   * Google sign-in arrives verified, so the path this product actually leads
   * people down is unaffected.
   */
  if (!identity.emailVerified) {
    /*
     * The client sends a fresh link immediately before this call, on both
     * sign-up and sign-in, so this message describes something that has just
     * happened. It said "the link Firebase sent you" first, which was untrue
     * and unhelpable: nothing sent one, because `sendEmailVerification` is not
     * automatic and was never being called.
     */
    throw new HTTPException(403, {
      message:
        'Almost there — open the verification link we just emailed you, then sign in again. Check spam if it is not in your inbox.',
    });
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
        .values({
          email: identity.email,
          firebaseUid: identity.uid,
          tokensValidFrom: NEVER_REVOKED,
        })
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
