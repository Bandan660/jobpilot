import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { createDb, cleanSecret } from '../db/client.js';
import { verifyToken } from '../auth/jwt.js';
import { userReports, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../env.js';

const reportSchema = z.object({
  category: z.enum(['autofill', 'parser', 'site_issue', 'bug', 'suggestion', 'other']).default('bug'),
  subject: z.string().min(1).max(200),
  description: z.string().min(1).max(3000),
  pageUrl: z.string().max(2048).nullable().optional(),
});

export const reportRoutes = new Hono<AppContext>();

reportRoutes.post('/', async (c) => {
  const parsed = reportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? 'Invalid report input',
    });
  }

  const header = c.req.header('Authorization') ?? '';
  const [scheme, token] = header.split(' ');

  let userId: string | null = null;
  let userEmail: string | null = null;

  if (scheme?.toLowerCase() === 'bearer' && token) {
    try {
      const verifiedId = await verifyToken(token, cleanSecret(c.env.JWT_SECRET));
      if (verifiedId) {
        userId = verifiedId;
        const db = createDb(c.env);
        const user = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        userEmail = user[0]?.email ?? null;
      }
    } catch {
      /* Token verification error fallback */
    }
  }

  const db = createDb(c.env);

  const [report] = await db
    .insert(userReports)
    .values({
      userId,
      userEmail,
      category: parsed.data.category,
      subject: parsed.data.subject,
      description: parsed.data.description,
      pageUrl: parsed.data.pageUrl ?? null,
      status: 'open',
    })
    .returning();

  return c.json({ report }, 201);
});
