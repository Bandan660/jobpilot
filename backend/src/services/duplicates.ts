import { and, desc, eq, or } from 'drizzle-orm';
import {
  canonicalizeJobUrl,
  daysBetween,
  normalizeCompany,
  normalizeTitle,
  type DuplicateMatch,
  type ApplicationStatus,
} from '@jobpilot/shared';
import type { Database } from '../db/client.js';
import { applications, companies } from '../db/schema.js';

/** Beyond this, "you applied here before" stops being useful and starts being noise. */
const SAME_COMPANY_WINDOW_DAYS = 180;

/**
 * Find prior applications that might be the same role.
 *
 * Three tiers, strongest first:
 *   EXACT_URL    - same canonical posting URL. Almost certainly a re-apply.
 *   EXACT_ROLE   - same company + same normalized title. Very likely the same job.
 *   SAME_COMPANY - same company, any role, within 180 days. Context, not a warning.
 *
 * Returns at most one match per application, keeping its strongest tier.
 */
export async function findDuplicates(
  db: Database,
  userId: string,
  input: { jobUrl?: string | null; company?: string | null; title?: string | null }
): Promise<DuplicateMatch[]> {
  const canonicalUrl = canonicalizeJobUrl(input.jobUrl);
  const companySlug = normalizeCompany(input.company);
  const titleSlug = normalizeTitle(input.title);

  if (!canonicalUrl && !companySlug) return [];

  const cutoff = new Date(Date.now() - SAME_COMPANY_WINDOW_DAYS * 86_400_000);

  // One query covering all tiers: everything for this user at this company,
  // plus anything matching the URL even if the company string differs.
  const companyRow = companySlug
    ? (await db.select().from(companies).where(eq(companies.slug, companySlug)).limit(1))[0]
    : undefined;

  const rows = await db
    .select({
      id: applications.id,
      title: applications.title,
      titleSlug: applications.titleSlug,
      status: applications.status,
      appliedAt: applications.appliedAt,
      createdAt: applications.createdAt,
      jobUrlCanonical: applications.jobUrlCanonical,
      companyId: applications.companyId,
      companyName: companies.name,
    })
    .from(applications)
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .where(
      and(
        eq(applications.userId, userId),
        // Same company OR same canonical URL. Both sides are indexed, so this
        // stays cheap; tier assignment happens on the (small) result set below.
        or(
          companyRow ? eq(applications.companyId, companyRow.id) : undefined,
          canonicalUrl ? eq(applications.jobUrlCanonical, canonicalUrl) : undefined
        )
      )
    )
    .orderBy(desc(applications.createdAt))
    .limit(200);

  const matches = new Map<string, DuplicateMatch>();

  for (const row of rows) {
    const reference = row.appliedAt ?? row.createdAt;

    let confidence: DuplicateMatch['confidence'] | null = null;

    if (canonicalUrl && row.jobUrlCanonical === canonicalUrl) {
      confidence = 'EXACT_URL';
    } else if (companyRow && row.companyId === companyRow.id && titleSlug && row.titleSlug === titleSlug) {
      confidence = 'EXACT_ROLE';
    } else if (companyRow && row.companyId === companyRow.id && reference >= cutoff) {
      confidence = 'SAME_COMPANY';
    }

    if (!confidence) continue;

    const existing = matches.get(row.id);
    if (existing && rank(existing.confidence) <= rank(confidence)) continue;

    matches.set(row.id, {
      applicationId: row.id,
      confidence,
      title: row.title,
      companyName: row.companyName,
      status: row.status as ApplicationStatus,
      appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
      daysAgo: daysBetween(reference),
    });
  }

  return [...matches.values()].sort((a, b) => rank(a.confidence) - rank(b.confidence));
}

function rank(confidence: DuplicateMatch['confidence']): number {
  switch (confidence) {
    case 'EXACT_URL':
      return 0;
    case 'EXACT_ROLE':
      return 1;
    default:
      return 2;
  }
}
