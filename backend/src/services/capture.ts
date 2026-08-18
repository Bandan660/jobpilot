import { and, asc, eq, or } from 'drizzle-orm';
import {
  canonicalizeJobUrl,
  normalizeCompany,
  normalizeTitle,
  parseCompensation,
  type ApplicationStatus,
  type CaptureRequest,
  type CaptureResponse,
} from '@jobpilot/shared';
import type { Database } from '../db/client.js';
import { applicationEvents, applications, companies } from '../db/schema.js';
import { findDuplicates } from './duplicates.js';
import { toApplicationDto } from './serialize.js';

/** Clock skew and stale queued captures both get clamped to this window. */
const MAX_CAPTURE_AGE_MS = 7 * 86_400_000;

/**
 * Statuses we will never walk backwards from.
 *
 * If a user re-opens a posting they already interviewed for, the extension
 * fires a capture again -- that must not reset the row to APPLIED and destroy
 * their real progress.
 */
const PROTECTED: readonly ApplicationStatus[] = [
  'SCREEN',
  'INTERVIEW',
  'OFFER',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
];

function clampCapturedAt(raw: string): Date {
  const parsed = new Date(raw);
  const now = Date.now();
  if (Number.isNaN(parsed.getTime())) return new Date(now);
  const t = parsed.getTime();
  if (t > now) return new Date(now);
  if (t < now - MAX_CAPTURE_AGE_MS) return new Date(now - MAX_CAPTURE_AGE_MS);
  return parsed;
}

/** Fall back to the posting's host when the adapter can't find a company name. */
function deriveCompanyName(raw: string | null, jobUrl: string): string {
  if (raw && raw.trim()) return raw.trim();
  try {
    return new URL(jobUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown company';
  }
}

async function upsertCompany(db: Database, name: string, slug: string) {
  // Insert-or-ignore, then read back. Deliberately not onConflictDoUpdate:
  // a later capture with a worse-quality name (e.g. a bare hostname) must not
  // overwrite a good display name already stored.
  await db.insert(companies).values({ name, slug }).onConflictDoNothing({ target: companies.slug });

  const [row] = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);
  if (!row) throw new Error(`Company upsert failed for slug "${slug}"`);
  return row;
}

/**
 * Idempotent per (user, canonical URL): the partial unique index on
 * applications makes a repeated capture an update, not a duplicate row.
 */
export async function captureApplication(
  db: Database,
  userId: string,
  req: CaptureRequest
): Promise<CaptureResponse> {
  const { job, applied } = req;

  const canonicalUrl = canonicalizeJobUrl(job.jobUrl);
  const companyName = deriveCompanyName(job.company, job.jobUrl);
  const companySlug = normalizeCompany(companyName) || 'unknown';
  const title = job.title?.trim() || 'Unknown role';
  const titleSlug = normalizeTitle(title);
  const capturedAt = clampCapturedAt(req.capturedAt);
  const comp = parseCompensation(job.compRaw);

  const company = await upsertCompany(db, companyName, companySlug);

  /*
   * Is this posting already tracked?
   *
   * TWO KEYS, BECAUSE ONE POSTING HAS MANY URLS
   *
   * The canonical URL alone was not enough, and LinkedIn shows why: the same
   * job is reachable as /jobs/search?currentJobId=123 with whatever keywords,
   * geoId and filter params the search happened to carry, as /jobs/view/123,
   * and as /jobs/view/{slug}-123 from any shared link. Those canonicalise to
   * four different keys, so saving a job from the search pane and applying to
   * it from the posting page produced two rows — one SAVED, one APPLIED, for
   * one job.
   *
   * It became routine rather than occasional when logging a referral ask
   * started creating the SAVED row: the ask is logged from wherever the user
   * was browsing, and the application is submitted from the posting page.
   *
   * `externalId` is the ATS's own id for the job and every path captures it,
   * so it survives the URL varying. Scoped to the company as well as the ATS
   * because it is only unique *within* an employer — `genericAdapter` reads it
   * from JSON-LD `identifier`, where "1" is a perfectly ordinary value, and
   * two employers both using it must not collapse into one application.
   *
   * Oldest first: if both keys somehow find different rows, the row that has
   * been accumulating history is the one to keep.
   */
  const identityMatch = or(
    canonicalUrl ? eq(applications.jobUrlCanonical, canonicalUrl) : undefined,
    job.externalId
      ? and(
          eq(applications.ats, job.ats),
          eq(applications.companyId, company.id),
          eq(applications.externalId, job.externalId)
        )
      : undefined
  );

  const existing = identityMatch
    ? (
        await db
          .select()
          .from(applications)
          .where(and(eq(applications.userId, userId), identityMatch))
          .orderBy(asc(applications.createdAt))
          .limit(1)
      )[0]
    : undefined;

  const duplicates = await findDuplicates(db, userId, {
    jobUrl: job.jobUrl,
    company: companyName,
    title,
  });

  if (existing) {
    const currentStatus = existing.status as ApplicationStatus;
    const shouldPromote = applied && !PROTECTED.includes(currentStatus);
    const nextStatus: ApplicationStatus = shouldPromote ? 'APPLIED' : currentStatus;

    const [updated] = await db
      .update(applications)
      .set({
        status: nextStatus,
        appliedAt: shouldPromote ? (existing.appliedAt ?? capturedAt) : existing.appliedAt,
        // Only fill gaps; never clobber data the user may have corrected by hand.
        // jobUrl in particular: the row may have been created from a search-pane
        // URL and this capture may be the posting's own page, which is the
        // better link — but the first one recorded is the one the user has been
        // clicking, so it stays.
        jobUrl: existing.jobUrl ?? job.jobUrl,
        jobUrlCanonical: existing.jobUrlCanonical ?? canonicalUrl,
        externalId: existing.externalId ?? job.externalId,
        location: existing.location ?? job.location,
        remote: existing.remote ?? job.remote,
        employmentType: existing.employmentType ?? job.employmentType,
        compRaw: existing.compRaw ?? job.compRaw,
        compMinCents: existing.compMinCents ?? comp.minCents,
        compMaxCents: existing.compMaxCents ?? comp.maxCents,
        compCurrency: existing.compCurrency ?? comp.currency,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, existing.id))
      .returning();

    if (nextStatus !== currentStatus) {
      await db.insert(applicationEvents).values({
        applicationId: updated.id,
        type: 'STATUS_CHANGED',
        actor: 'EXTENSION',
        fromStatus: currentStatus,
        toStatus: nextStatus,
        payload: { adapterVersion: job.adapterVersion, ats: job.ats },
        occurredAt: capturedAt,
      });
    }

    return {
      application: toApplicationDto(updated, company),
      created: false,
      duplicates: duplicates.filter((d) => d.applicationId !== updated.id),
    };
  }

  const [created] = await db
    .insert(applications)
    .values({
      userId,
      companyId: company.id,
      title,
      titleSlug,
      location: job.location,
      remote: job.remote,
      employmentType: job.employmentType,
      jobUrl: job.jobUrl,
      jobUrlCanonical: canonicalUrl,
      externalId: job.externalId,
      ats: job.ats,
      compRaw: job.compRaw,
      compMinCents: comp.minCents,
      compMaxCents: comp.maxCents,
      compCurrency: comp.currency,
      status: applied ? 'APPLIED' : 'SAVED',
      source: applied ? 'EXTENSION_AUTO' : 'EXTENSION_MANUAL',
      appliedAt: applied ? capturedAt : null,
      // We just saw the page, so the posting is live by definition.
      postingStatus: 'LIVE',
      postingCheckedAt: capturedAt,
    })
    .returning();

  await db.insert(applicationEvents).values({
    applicationId: created.id,
    type: 'CREATED',
    actor: 'EXTENSION',
    toStatus: created.status as ApplicationStatus,
    payload: { adapterVersion: job.adapterVersion, ats: job.ats, jobUrl: job.jobUrl },
    occurredAt: capturedAt,
  });

  if (duplicates.length > 0) {
    await db.insert(applicationEvents).values({
      applicationId: created.id,
      type: 'DUPLICATE_FLAGGED',
      actor: 'SYSTEM',
      payload: { matches: duplicates },
      occurredAt: capturedAt,
    });
  }

  return {
    application: toApplicationDto(created, company),
    created: true,
    duplicates,
  };
}
