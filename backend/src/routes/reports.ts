import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { createDb } from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';
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

reportRoutes.use('*', requireAuth);

reportRoutes.post('/', async (c) => {
  const parsed = reportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? 'Invalid report input',
    });
  }

  const userId = c.get('userId');
  const db = createDb(c.env);

  const user = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const userEmail = user[0]?.email ?? null;

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
