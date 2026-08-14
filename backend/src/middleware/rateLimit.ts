import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../env.js';

/**
 * Per-IP request limits on the endpoints where unlimited attempts are the
 * attack.
 *
 * WHAT THIS IS PROTECTING
 *
 * - `/api/auth/login`: unlimited password guessing against an eight-character
 *   minimum, with no lockout and no backoff.
 * - `/api/auth/signup` and `/login` both: each runs 100,000 PBKDF2 iterations
 *   by design (`auth/password.ts` explains why lowering that is not an
 *   option). That makes an unmetered auth endpoint a CPU amplifier — a few
 *   hundred concurrent requests exhaust the Worker's budget and bill for the
 *   privilege.
 * - `POST /api/reports`: unauthenticated writes, so anyone can fill the table.
 *
 * WHY CF-CONNECTING-IP
 *
 * Cloudflare sets it at the edge and overwrites anything the client sent, so
 * unlike `X-Forwarded-For` it cannot be spoofed by the caller. Requests that
 * somehow arrive without it share one bucket, which is the conservative
 * reading: unknown origin gets the same allowance as a single caller.
 *
 * WHY IT FAILS OPEN
 *
 * The binding is unavailable in `wrangler dev` and on any deploy where it has
 * not been created yet. Failing closed there would take sign-in down entirely
 * for a configuration problem — worse than the thing being defended against.
 * It is logged instead, so a production deploy silently missing its limiter is
 * visible in `wrangler tail` rather than invisible everywhere.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type LimiterName = 'AUTH_LIMITER' | 'REPORT_LIMITER';

/**
 * Optional extra dimension for the bucket key.
 *
 * Async because the useful one is the email in the request body. Reading it
 * here is safe: Hono caches the parsed body on the request, so the handler's
 * own `c.req.json()` still returns it rather than finding a consumed stream.
 */
export type RateLimitScope = (c: { json(): Promise<unknown> }) => Promise<string>;

export const rateLimit = (name: LimiterName, scope?: RateLimitScope) =>
  createMiddleware<AppContext>(async (c, next) => {
    const limiter = (c.env as unknown as Record<string, RateLimiter | undefined>)[name];

    if (!limiter?.limit) {
      console.warn('rate limiter binding missing', name);
      await next();
      return;
    }

    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const extra = scope ? await scope({ json: () => c.req.json() }).catch(() => '') : '';
    const key = extra ? `${ip}:${extra}` : ip;

    const { success } = await limiter.limit({ key });
    if (!success) {
      throw new HTTPException(429, {
        message: 'Too many attempts. Wait a minute and try again.',
      });
    }

    await next();
  });
