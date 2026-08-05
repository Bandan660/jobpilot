import type { Application, ApplicationEvent, ApplicationStatus } from '@jobpilot/shared';
import type { ApplicationEventRow, ApplicationRow, CompanyRow } from '../db/schema.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toApplicationDto(row: ApplicationRow, company: CompanyRow): Application {
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
    appliedAt: iso(row.appliedAt),
    firstResponseAt: iso(row.firstResponseAt),
    postingStatus: row.postingStatus as Application['postingStatus'],
    postingCheckedAt: iso(row.postingCheckedAt),
    postingCheckFailures: row.postingCheckFailures,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
