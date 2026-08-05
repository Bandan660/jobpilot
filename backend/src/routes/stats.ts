import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { getDeadPostingAlerts, getFunnelStats } from '../services/stats.js';
import { requireAuth } from '../middleware/auth.js';
import { numberVar, type AppContext } from '../env.js';

export const statsRoutes = new Hono<AppContext>();

statsRoutes.use('*', requireAuth);

statsRoutes.get('/funnel', async (c) => {
  const db = createDb(c.env);
  const ghostAfterDays = numberVar(c.env.GHOST_AFTER_DAYS, 30);
  const stats = await getFunnelStats(db, c.get('userId'), ghostAfterDays);
  return c.json(stats);
});

/** Applications still marked APPLIED where the posting has since come down. */
statsRoutes.get('/dead-postings', async (c) => {
  const db = createDb(c.env);
  const alerts = await getDeadPostingAlerts(db, c.get('userId'));
  return c.json({
    alerts: alerts.map((a) => ({
      ...a,
      appliedAt: a.appliedAt ? a.appliedAt.toISOString() : null,
    })),
  });
});
