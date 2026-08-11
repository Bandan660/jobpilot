import { sql } from 'drizzle-orm';
import type { AdminMetrics } from '@jobpilot/shared';
import type { Database } from '../db/client.js';
import { applications, users } from '../db/schema.js';

/**
 * Instrument readings for the whole service.
 *
 * COUNTS ONLY, AND THAT IS THE DESIGN
 *
 * Every query here is an aggregate. Nothing selects an email, a job title, a
 * company or an id, so there is no row in any response that describes a person
 * — which is what keeps the existing privacy policy true and keeps a leaked
 * admin session from being a breach of anyone's job search.
 *
 * That constraint is easy to erode one useful column at a time. "Just the
 * newest signup's email" is how a metrics page becomes a user directory. If
 * individual records are ever genuinely needed, that is a different feature
 * with a different disclosure, not a field added here.
 */

export async function getAdminMetrics(db: Database): Promise<AdminMetrics> {
  /*
   * One round trip per shape rather than one giant query. These are small
   * aggregates over indexed columns, and a readable query that runs in
   * milliseconds beats a clever one nobody can modify later.
   */
  const [userCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last7: sql<number>`count(*) filter (where ${users.createdAt} > now() - interval '7 days')::int`,
      last30: sql<number>`count(*) filter (where ${users.createdAt} > now() - interval '30 days')::int`,
    })
    .from(users);

  const [appCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last7: sql<number>`count(*) filter (where ${applications.createdAt} > now() - interval '7 days')::int`,
      last30: sql<number>`count(*) filter (where ${applications.createdAt} > now() - interval '30 days')::int`,
      withResume: sql<number>`count(*) filter (where ${applications.resumeId} is not null)::int`,
    })
    .from(applications);

  /*
   * generate_series, not a group-by over the rows that exist.
   *
   * A day with no signups produces no row, and a chart drawn from that draws a
   * flat line through the gap — which reads as "steady" when it means "none".
   * The series supplies every day and the join fills in what happened.
   */
  const signups = await db.execute<{ date: string; count: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as date,
           count(u.id)::int as count
      from generate_series(
             date_trunc('day', now() - interval '29 days'),
             date_trunc('day', now()),
             interval '1 day'
           ) as d(day)
      left join ${users} u
        on date_trunc('day', u.created_at) = d.day
     group by d.day
     order by d.day asc
  `);

  const platforms = await db
    .select({ ats: applications.ats, count: sql<number>`count(*)::int` })
    .from(applications)
    .groupBy(applications.ats)
    .orderBy(sql`count(*) desc`);

  const statuses = await db
    .select({ status: applications.status, count: sql<number>`count(*)::int` })
    .from(applications)
    .groupBy(applications.status)
    .orderBy(sql`count(*) desc`);

  const postings = await db
    .select({ postingStatus: applications.postingStatus, count: sql<number>`count(*)::int` })
    .from(applications)
    .groupBy(applications.postingStatus)
    .orderBy(sql`count(*) desc`);

  const [activated] = await db
    .select({ count: sql<number>`count(distinct ${applications.userId})::int` })
    .from(applications);

  return {
    users: {
      total: userCounts?.total ?? 0,
      last7: userCounts?.last7 ?? 0,
      last30: userCounts?.last30 ?? 0,
    },
    applications: {
      total: appCounts?.total ?? 0,
      last7: appCounts?.last7 ?? 0,
      last30: appCounts?.last30 ?? 0,
      withResume: appCounts?.withResume ?? 0,
    },
    // `.rows`, not the result itself: the Neon HTTP driver returns a result
    // object rather than an array, and spreading it yields nothing.
    signups: signups.rows.map((row) => ({ date: row.date, count: Number(row.count) })),
    platforms: platforms.map((row) => ({ ats: row.ats ?? 'UNKNOWN', count: row.count })),
    statuses: statuses.map((row) => ({ status: row.status, count: row.count })),
    postings: postings.map((row) => ({ status: row.postingStatus, count: row.count })),
    activatedUsers: activated?.count ?? 0,
  };
}
