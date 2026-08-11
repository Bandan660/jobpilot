import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { getAdminMetrics } from '../services/admin.js';
import type { AppContext } from '../env.js';

export const adminRoutes = new Hono<AppContext>();

/*
 * Both, in this order, on every route in this module.
 *
 * `requireAuth` establishes who the caller is; `requireAdmin` decides whether
 * that person may be here. Applied with a wildcard rather than per-route so a
 * route added later cannot be the one that forgot — the failure mode of
 * per-route middleware is a new endpoint quietly shipping unguarded.
 */
adminRoutes.use('*', requireAuth);
adminRoutes.use('*', requireAdmin);

/** Service-wide aggregates. No personal data — see services/admin.ts. */
adminRoutes.get('/metrics', async (c) => {
  const db = createDb(c.env);
  return c.json(await getAdminMetrics(db));
});
