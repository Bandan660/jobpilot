import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { verifyToken } from '../auth/jwt.js';
import type { AppContext } from '../env.js';

/**
 * Requires a `Authorization: Bearer <jwt>` header and puts the user id on the
 * context as `userId`. Every route past this point can trust it.
 */
export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new HTTPException(401, { message: 'Missing bearer token' });
  }

  const userId = await verifyToken(token, c.env.JWT_SECRET);
  if (!userId) {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  c.set('userId', userId);
  await next();
});
