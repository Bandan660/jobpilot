import { and, asc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { PostingStatus } from '@jobpilot/shared';
import { ACTIVE_STATUSES } from '@jobpilot/shared';
import type { Database } from '../db/client.js';
import { applicationEvents, applications } from '../db/schema.js';
import { numberVar, type Env } from '../env.js';

/**
 * Dead-posting detector.
 *
 * Re-fetches saved postings on a schedule and records whether the job is still
 * up. A posting coming down is strong evidence the role is filled or frozen --
 * information the user otherwise only gets by waiting in silence.
 *
 * SUBREQUEST BUDGET: the Workers free plan allows 50 subrequests per
 * invocation, and every Neon HTTP query counts. One sweep costs
 * (batch fetches + 1 select + <=4 grouped updates + 1 event insert), so the
 * default batch of 15 leaves comfortable headroom. Raising the batch size past
 * ~40 will start failing runs.
 */

/** Stop re-checking a URL that has failed this many times in a row. */
const MAX_FAILURES = 5;

const FETCH_TIMEOUT_MS = 8_000;
/** Only the head of the body is scanned for closed-phrases. */
const MAX_BODY_BYTES = 64 * 1024;

const CLOSED_PHRASES = [
  'no longer accepting application',
  'we are no longer accepting',
  'this job is no longer available',
  'this position is no longer available',
  'position has been filled',
  'this role has been filled',
  'posting is no longer active',
  'job posting has closed',
  'applications are closed',
  'this job has expired',
  'job not found',
];

type Outcome =
  | { kind: 'status'; id: string; status: PostingStatus; httpStatus: number | null; finalUrl: string }
  | { kind: 'failure'; id: string; reason: string };

/** Rows the sweep is allowed to touch. */
async function selectBatch(db: Database, env: Env) {
  const recheckAfterHours = numberVar(env.POSTING_RECHECK_AFTER_HOURS, 24);
  const batchSize = numberVar(env.POSTING_CHECK_BATCH_SIZE, 15);
  const cutoff = new Date(Date.now() - recheckAfterHours * 3_600_000);

  return db
    .select({
      id: applications.id,
      jobUrl: applications.jobUrl,
      postingStatus: applications.postingStatus,
    })
    .from(applications)
    .where(
      and(
        isNotNull(applications.jobUrl),
        // Only roles the user is still waiting on. Checking a rejected
        // application's posting tells us nothing useful.
        inArray(applications.status, [...ACTIVE_STATUSES]),
        inArray(applications.postingStatus, ['LIVE', 'UNKNOWN']),
        lt(applications.postingCheckFailures, MAX_FAILURES),
        or(sql`${applications.postingCheckedAt} is null`, lt(applications.postingCheckedAt, cutoff))
      )
    )
    // Nulls first: never-checked postings are the most informative.
    .orderBy(sql`${applications.postingCheckedAt} asc nulls first`)
    .limit(batchSize);
}

function looksClosed(body: string): boolean {
  const haystack = body.toLowerCase();
  return CLOSED_PHRASES.some((phrase) => haystack.includes(phrase));
}

/**
 * Redirected off a deep job path onto a shallow one (e.g.
 * /company/jobs/123 -> /company). ATSs do this when a posting is pulled.
 */
function redirectedToListing(originalUrl: string, finalUrl: string): boolean {
  try {
    const from = new URL(originalUrl);
    const to = new URL(finalUrl);
    if (from.href === to.href) return false;
    const fromDepth = from.pathname.split('/').filter(Boolean).length;
    const toDepth = to.pathname.split('/').filter(Boolean).length;
    return toDepth < fromDepth && fromDepth - toDepth >= 2;
  } catch {
    return false;
  }
}

async function checkOne(id: string, jobUrl: string): Promise<Outcome> {
  try {
    const response = await fetch(jobUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Some ATSs serve a bot wall to unknown agents; identify honestly and
        // let them block us rather than pretending to be a browser.
        'User-Agent': 'jobpilot-posting-checker/0.1 (+https://jobpilot.app/bot)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    const finalUrl = response.url || jobUrl;

    // Definitive: the resource is gone.
    if (response.status === 404 || response.status === 410) {
      return { kind: 'status', id, status: 'REMOVED', httpStatus: response.status, finalUrl };
    }

    // Inconclusive: rate limits, bot walls, and server errors say nothing
    // about the job. Never infer "dead" from these.
    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      return { kind: 'failure', id, reason: `http_${response.status}` };
    }

    if (!response.ok) {
      return { kind: 'failure', id, reason: `http_${response.status}` };
    }

    if (redirectedToListing(jobUrl, finalUrl)) {
      return { kind: 'status', id, status: 'REMOVED', httpStatus: response.status, finalUrl };
    }

    const body = (await response.text()).slice(0, MAX_BODY_BYTES);
    const status: PostingStatus = looksClosed(body) ? 'CLOSED' : 'LIVE';
    return { kind: 'status', id, status, httpStatus: response.status, finalUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown';
    return { kind: 'failure', id, reason };
  }
}

export interface SweepResult {
  checked: number;
  live: number;
  removed: number;
  closed: number;
  failed: number;
}

export async function sweepPostings(db: Database, env: Env): Promise<SweepResult> {
  const batch = await selectBatch(db, env);
  if (batch.length === 0) {
    return { checked: 0, live: 0, removed: 0, closed: 0, failed: 0 };
  }

  const outcomes = await Promise.all(batch.map((row) => checkOne(row.id, row.jobUrl!)));
  const now = new Date();

  const byStatus: Record<PostingStatus, string[]> = {
    LIVE: [],
    REMOVED: [],
    CLOSED: [],
    UNKNOWN: [],
  };
  const failedIds: string[] = [];

  for (const outcome of outcomes) {
    if (outcome.kind === 'status') byStatus[outcome.status].push(outcome.id);
    else failedIds.push(outcome.id);
  }

  // Grouped updates, one query per outcome kind, to stay inside the
  // subrequest budget.
  for (const status of ['LIVE', 'REMOVED', 'CLOSED'] as const) {
    const ids = byStatus[status];
    if (ids.length === 0) continue;
    await db
      .update(applications)
      .set({
        postingStatus: status,
        postingCheckedAt: now,
        postingCheckFailures: 0,
        updatedAt: now,
      })
      .where(inArray(applications.id, ids));
  }

  if (failedIds.length > 0) {
    await db
      .update(applications)
      .set({
        postingCheckedAt: now,
        postingCheckFailures: sql`${applications.postingCheckFailures} + 1`,
        updatedAt: now,
      })
      .where(inArray(applications.id, failedIds));
  }

  // One insert for the whole batch.
  await db.insert(applicationEvents).values(
    outcomes.map((outcome) => ({
      applicationId: outcome.id,
      type: 'POSTING_CHECKED' as const,
      actor: 'SYSTEM' as const,
      payload:
        outcome.kind === 'status'
          ? { postingStatus: outcome.status, httpStatus: outcome.httpStatus, finalUrl: outcome.finalUrl }
          : { failed: true, reason: outcome.reason },
      occurredAt: now,
    }))
  );

  return {
    checked: outcomes.length,
    live: byStatus.LIVE.length,
    removed: byStatus.REMOVED.length,
    closed: byStatus.CLOSED.length,
    failed: failedIds.length,
  };
}
