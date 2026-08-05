import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthResponse } from '@jobpilot/shared';
import { createDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
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

  const token = await signToken(user.id, c.env.JWT_SECRET);
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
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    throw new HTTPException(401, { message: 'Invalid email or password' });
  }

  const token = await signToken(user.id, c.env.JWT_SECRET);
  const body: AuthResponse = {
    token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() },
  };
  return c.json(body);
});
