import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { ApiError } from '@jobpilot/shared';
import { authRoutes } from './routes/auth.js';
import { applicationRoutes } from './routes/applications.js';
import { captureRoutes } from './routes/capture.js';
import { profileRoutes } from './routes/profile.js';
import { resumeRoutes } from './routes/resumes.js';
import { statsRoutes } from './routes/stats.js';
import { analyzeRoutes } from './routes/analyze.js';
import { adminRoutes } from './routes/admin.js';
import { createDb } from './db/client.js';
import { sweepPostings } from './workers/postingChecker.js';
import { isAllowedOrigin, type AppContext, type Env } from './env.js';

const app = new Hono<AppContext>();

app.use('*', (c, next) =>
  cors({
    // Exact origins, the chrome-extension scheme, and Pages preview
    // deployments. See isAllowedOrigin for why the suffix rule is narrow.
    origin: (origin) => (isAllowedOrigin(origin, c.env) ? origin : undefined),
    // Must list every method any route uses. PUT was missing, which broke
    // saving the profile from a browser — and curl never caught it, because
    // curl does not enforce CORS. Only browsers do.
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    /*
     * Every custom header any request sends, for the same reason as the method
     * list above: the browser preflights them and blocks the request outright
     * if one is missing. X-File-Name carries the resume filename, since the
     * upload sends the file as a raw body rather than multipart.
     *
     * Adding a custom header anywhere in the client means adding it here too.
     * curl will not tell you — it does not preflight.
     */
    allowHeaders: ['Content-Type', 'Authorization', 'X-File-Name'],
    maxAge: 86_400,
  })(c, next)
);

app.get('/health', (c) => c.json({ ok: true, service: 'jobpilot-api' }));

import { publicBlogRoutes } from './routes/blog.js';

app.route('/api/auth', authRoutes);
app.route('/api/applications', applicationRoutes);
app.route('/api/capture', captureRoutes);
app.route('/api/profile', profileRoutes);
app.route('/api/resumes', resumeRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/analyze', analyzeRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/blog', publicBlogRoutes);

app.notFound((c) => {
  const body: ApiError = { error: 'not_found', message: 'No such endpoint' };
  return c.json(body, 404);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const body: ApiError = { error: 'request_failed', message: err.message };
    return c.json(body, err.status);
  }

  // Unexpected: log the detail for `wrangler tail`, return a generic message
  // so internal errors never leak to clients.
  console.error('Unhandled error:', err);
  const body: ApiError = { error: 'internal_error', message: 'Something went wrong' };
  return c.json(body, 500);
});

export default {
  fetch: app.fetch,

  /** Cron Trigger entrypoint -- the dead-posting sweep. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          const db = createDb(env);
          const result = await sweepPostings(db, env);
          console.log('Posting sweep complete:', JSON.stringify(result));
        } catch (error) {
          console.error('Posting sweep failed:', error);
        }
      })()
    );
  },
};
