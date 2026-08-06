import { and, desc, eq, sql } from 'drizzle-orm';
import { APPLICATION_STATUS, type ApplicationStatus, type FunnelStats } from '@jobpilot/shared';
import type { Database } from '../db/client.js';
import { applicationEvents, applications, companies } from '../db/schema.js';

/**
 * Ghosting is DERIVED, never stored.
 *
 * An application counts as ghosted when the user applied, got no response, and
 * either the posting came down or enough time passed in silence. Storing it as
 * a status would mean the dead-posting worker overwriting user-owned state,
 * and would go stale the moment a late reply arrives.
 */
export async function getFunnelStats(
  db: Database,
  userId: string,
  ghostAfterDays: number
): Promise<FunnelStats> {
  const counts = await db
    .select({ status: applications.status, count: sql<number>`count(*)::int` })
    .from(applications)
    .where(eq(applications.userId, userId))
    .groupBy(applications.status);

  const byStatus = Object.fromEntries(
    APPLICATION_STATUS.map((s) => [s, 0])
  ) as Record<ApplicationStatus, number>;

  let total = 0;
  for (const row of counts) {
    byStatus[row.status as ApplicationStatus] = row.count;
    total += row.count;
  }

  const [aggregates] = await db
    .select({
      applied: sql<number>`count(*) filter (where ${applications.appliedAt} is not null)::int`,
      responded: sql<number>`count(*) filter (where ${applications.firstResponseAt} is not null)::int`,
      medianDays: sql<number | null>`
        percentile_cont(0.5) within group (
          order by extract(epoch from (${applications.firstResponseAt} - ${applications.appliedAt})) / 86400
        ) filter (where ${applications.firstResponseAt} is not null and ${applications.appliedAt} is not null)
      `,
      ghosted: sql<number>`
        count(*) filter (
          where ${applications.appliedAt} is not null
            and ${applications.firstResponseAt} is null
            and ${applications.status} = 'APPLIED'
            and (
              ${applications.postingStatus} in ('REMOVED', 'CLOSED')
              or ${applications.appliedAt} < now() - make_interval(days => ${ghostAfterDays})
            )
        )::int
      `,
    })
    .from(applications)
    .where(eq(applications.userId, userId));

  const applied = aggregates?.applied ?? 0;
  const responded = aggregates?.responded ?? 0;

  return {
    total,
    byStatus,
    responseRate: applied > 0 ? responded / applied : 0,
    medianDaysToResponse:
      aggregates?.medianDays != null ? Math.round(Number(aggregates.medianDays) * 10) / 10 : null,
    ghostedCount: aggregates?.ghosted ?? 0,
  };
}

/**
 * Recent activity across every application.
 *
 * Reads straight from the append-only event log, which is why it can show
 * things the user never typed — a posting going down, a duplicate flagged at
 * capture time. That is the whole reason the log exists.
 */
export async function getRecentActivity(db: Database, userId: string, limit = 12) {
  return db
    .select({
      id: applicationEvents.id,
      type: applicationEvents.type,
      actor: applicationEvents.actor,
      fromStatus: applicationEvents.fromStatus,
      toStatus: applicationEvents.toStatus,
      occurredAt: applicationEvents.occurredAt,
      applicationId: applications.id,
      title: applications.title,
      companyName: companies.name,
    })
    .from(applicationEvents)
    .innerJoin(applications, eq(applicationEvents.applicationId, applications.id))
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .where(
      and(
        eq(applications.userId, userId),
        // Liveness checks that found nothing changed are noise, not activity.
        sql`${applicationEvents.type} <> 'POSTING_CHECKED'
            or ${applicationEvents.payload}->>'postingStatus' in ('REMOVED','CLOSED')`
      )
    )
    .orderBy(desc(applicationEvents.occurredAt))
    .limit(limit);
}

/** Applications the user is still waiting on, where the posting has gone down. */
export async function getDeadPostingAlerts(db: Database, userId: string) {
  return db
    .select({
      id: applications.id,
      title: applications.title,
      postingStatus: applications.postingStatus,
      appliedAt: applications.appliedAt,
    })
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        eq(applications.status, 'APPLIED'),
        sql`${applications.firstResponseAt} is null`,
        sql`${applications.postingStatus} in ('REMOVED', 'CLOSED')`
      )
    )
    .limit(50);
}
