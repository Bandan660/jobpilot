import type {
  Application,
  ApplicationEvent,
  ApplicationStatus,
  Contact,
  ReferralStatus,
} from '@jobpilot/shared';
import type {
  ApplicationEventRow,
  ApplicationRow,
  CompanyRow,
  ContactRow,
} from '../db/schema.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * `referrals` is optional because only the endpoints that run the aggregate
 * pass it. Capture, import and the duplicate check all build an `Application`
 * without one, and leaving the fields absent there is the honest answer —
 * "not counted" is not "none".
 */
export function toApplicationDto(
  row: ApplicationRow,
  company: CompanyRow,
  referrals?: { count: number; accepted: number }
): Application {
  return {
    id: row.id,
    userId: row.userId,
    companyId: row.companyId,
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      domain: company.domain,
    },
    title: row.title,
    titleSlug: row.titleSlug,
    location: row.location,
    remote: row.remote,
    employmentType: row.employmentType as Application['employmentType'],
    jobUrl: row.jobUrl,
    jobUrlCanonical: row.jobUrlCanonical,
    externalId: row.externalId,
    ats: row.ats as Application['ats'],
    compMinCents: row.compMinCents,
    compMaxCents: row.compMaxCents,
    compCurrency: row.compCurrency,
    compRaw: row.compRaw,
    status: row.status as ApplicationStatus,
    source: row.source as Application['source'],
    archived: row.archived,
    starred: row.starred,
    resumeId: row.resumeId,
    appliedAt: iso(row.appliedAt),
    firstResponseAt: iso(row.firstResponseAt),
    postingStatus: row.postingStatus as Application['postingStatus'],
    postingCheckedAt: iso(row.postingCheckedAt),
    postingCheckFailures: row.postingCheckFailures,
    ...(referrals
      ? { referralCount: referrals.count, referralAccepted: referrals.accepted }
      : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toContactDto(row: ContactRow): Contact {
  return {
    id: row.id,
    applicationId: row.applicationId,
    name: row.name,
    email: row.email,
    role: row.role,
    linkedinUrl: row.linkedinUrl,
    /*
     * Cast, not validated. `status` is text in Postgres precisely so the set
     * can grow without a migration, which means a row written by a newer
     * deploy can carry a value this build does not know. Widening it to a
     * string in the DTO would push that problem into every consumer; the UI
     * falls back to the raw value when the label lookup misses.
     */
    status: row.status as ReferralStatus,
    statusAt: row.statusAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toEventDto(row: ApplicationEventRow): ApplicationEvent {
  return {
    id: row.id,
    applicationId: row.applicationId,
    type: row.type as ApplicationEvent['type'],
    actor: row.actor as ApplicationEvent['actor'],
    fromStatus: row.fromStatus as ApplicationStatus | null,
    toStatus: row.toStatus as ApplicationStatus | null,
    payload: row.payload ?? null,
    occurredAt: row.occurredAt.toISOString(),
  };
}
