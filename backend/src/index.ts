import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { ApiError } from '@jobpilot/shared';
import { authRoutes } from './routes/auth.js';
import { applicationRoutes } from './routes/applications.js';
import { captureRoutes } from './routes/capture.js';
import { profileRoutes } from './routes/profile.js';
import { statsRoutes } from './routes/stats.js';
import { createDb } from './db/client.js';
import { sweepPostings } from './workers/postingChecker.js';
import { corsOrigins, type AppContext, type Env } from './env.js';

const app = new Hono<AppContext>();

app.use('*', (c, next) =>
  cors({
    /**
     * The extension's origin is chrome-extension://<id>, and the id changes
     * between the unpacked dev build and the published one. Rather than
     * hardcode it, allow the scheme and pin the rest to CORS_ORIGINS.
     */
    origin: (origin) => {
      if (!origin) return undefined;
      if (origin.startsWith('chrome-extension://')) return origin;
      return corsOrigins(c.env).includes(origin) ? origin : undefined;
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  })(c, next)
);

app.get('/health', (c) => c.json({ ok: true, service: 'jobpilot-api' }));

app.route('/api/auth', authRoutes);
app.route('/api/applications', applicationRoutes);
app.route('/api/capture', captureRoutes);
app.route('/api/profile', profileRoutes);
app.route('/api/stats', statsRoutes);

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
