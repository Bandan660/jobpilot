import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  APPLICATION_SOURCE,
  APPLICATION_STATUS,
  ATS_PROVIDER,
  EVENT_ACTOR,
  EVENT_TYPE,
  POSTING_STATUS,
} from '@jobpilot/shared';

/** Drizzle wants a non-empty tuple; the shared arrays are readonly. */
const asEnumValues = <T extends readonly string[]>(values: T) =>
  values as unknown as [string, ...string[]];

export const applicationStatusEnum = pgEnum('application_status', asEnumValues(APPLICATION_STATUS));
export const postingStatusEnum = pgEnum('posting_status', asEnumValues(POSTING_STATUS));
export const atsProviderEnum = pgEnum('ats_provider', asEnumValues(ATS_PROVIDER));
export const applicationSourceEnum = pgEnum('application_source', asEnumValues(APPLICATION_SOURCE));
export const eventTypeEnum = pgEnum('event_type', asEnumValues(EVENT_TYPE));
export const eventActorEnum = pgEnum('event_actor', asEnumValues(EVENT_ACTOR));

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /** PBKDF2 output, encoded by hashPassword() in auth/password.ts. */
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(sql`lower(${t.email})`),
  })
);

/**
 * Companies are global, not per-user. That is deliberate: cross-user aggregates
 * (median response time, ghost rate) are the whole point of the response
 * intelligence feature, and they need one row per real company.
 */
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Display name, from whichever capture saw it first. */
    name: text('name').notNull(),
    /** normalizeCompany(name). The real identity key. */
    slug: text('slug').notNull(),
    domain: text('domain'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('companies_slug_idx').on(t.slug),
  })
);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    title: text('title').notNull(),
    titleSlug: text('title_slug').notNull(),
    location: text('location'),
    remote: boolean('remote'),

    jobUrl: text('job_url'),
    jobUrlCanonical: text('job_url_canonical'),
    externalId: text('external_id'),
    ats: atsProviderEnum('ats'),

    compMinCents: integer('comp_min_cents'),
    compMaxCents: integer('comp_max_cents'),
    compCurrency: text('comp_currency'),
    compRaw: text('comp_raw'),

    status: applicationStatusEnum('status').notNull().default('SAVED'),
    source: applicationSourceEnum('source').notNull().default('EXTENSION_AUTO'),

    appliedAt: timestamp('applied_at', { withTimezone: true }),
    /** Set once, on the first inbound response. Null = still waiting. */
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),

    postingStatus: postingStatusEnum('posting_status').notNull().default('UNKNOWN'),
    postingCheckedAt: timestamp('posting_checked_at', { withTimezone: true }),
    /**
     * Consecutive *inconclusive* liveness checks (timeouts, 403 bot walls,
     * 5xx). These never mark a posting dead -- only definitive signals (404,
     * 410, a closed-phrase in the body) do that. The counter exists so the
     * sweep stops retrying permanently unreachable URLs; see MAX_FAILURES in
     * workers/postingChecker.ts.
     */
    postingCheckFailures: integer('posting_check_failures').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * Partial unique: one row per user per canonical URL. This is what makes
     * capture idempotent -- the extension can fire twice on a flaky submit and
     * the second call updates instead of duplicating. Rows with a null URL
     * (manual entries) are exempt.
     */
    userUrlIdx: uniqueIndex('applications_user_url_idx')
      .on(t.userId, t.jobUrlCanonical)
      .where(sql`${t.jobUrlCanonical} is not null`),

    /** Backs the EXACT_ROLE duplicate check. */
    userRoleIdx: index('applications_user_role_idx').on(t.userId, t.companyId, t.titleSlug),

    userStatusIdx: index('applications_user_status_idx').on(t.userId, t.status),

    /**
     * Backs the cron sweep: "oldest live postings not checked recently".
     * Partial, so it stays small as dead rows accumulate.
     */
    postingSweepIdx: index('applications_posting_sweep_idx')
      .on(t.postingCheckedAt)
      .where(sql`${t.postingStatus} in ('LIVE', 'UNKNOWN')`),

    /** Backs cross-user response-time aggregates. */
    companyStatsIdx: index('applications_company_stats_idx').on(t.companyId, t.appliedAt),
  })
);

/**
 * Append-only. Nothing in this table is ever updated or deleted.
 *
 * Every status change flows through here regardless of origin, which is what
 * makes Gmail auto-status a pure addition later: the ingester writes
 * STATUS_CHANGED rows with actor='EMAIL' and the rest of the system is
 * unchanged. It also gives time-between-stage analytics for free.
 */
export const applicationEvents = pgTable(
  'application_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    type: eventTypeEnum('type').notNull(),
    actor: eventActorEnum('actor').notNull(),
    fromStatus: applicationStatusEnum('from_status'),
    toStatus: applicationStatusEnum('to_status'),
    /** Per-type detail: scraped fields, HTTP status, matched email subject. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appIdx: index('application_events_app_idx').on(t.applicationId, t.occurredAt),
    typeIdx: index('application_events_type_idx').on(t.type, t.occurredAt),
  })
);

/**
 * The single profile autofill reads from. One row per user.
 *
 * Scalars are columns because the autofill matcher targets them individually
 * and they need to be queryable; the repeating groups are jsonb because they
 * are only ever read and written whole, and giving each its own table would
 * buy nothing but joins.
 *
 * `demographics` holds voluntary self-identification data. It is stored
 * separately and gated behind its own `enabled` flag so autofill can skip the
 * whole group without the caller having to know which fields are sensitive.
 */
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    firstName: text('first_name'),
    lastName: text('last_name'),
    preferredName: text('preferred_name'),
    email: text('email'),
    phone: text('phone'),

    addressLine1: text('address_line1'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),

    linkedinUrl: text('linkedin_url'),
    githubUrl: text('github_url'),
    portfolioUrl: text('portfolio_url'),
    otherUrl: text('other_url'),

    currentCompany: text('current_company'),
    currentTitle: text('current_title'),

    authorizedToWork: boolean('authorized_to_work'),
    requiresSponsorship: boolean('requires_sponsorship'),
    willingToRelocate: boolean('willing_to_relocate'),
    noticePeriod: text('notice_period'),
    salaryExpectation: text('salary_expectation'),
    referralSource: text('referral_source'),

    experience: jsonb('experience').$type<unknown[]>().notNull().default([]),
    education: jsonb('education').$type<unknown[]>().notNull().default([]),
    savedAnswers: jsonb('saved_answers').$type<unknown[]>().notNull().default([]),
    demographics: jsonb('demographics')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({ enabled: false }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: uniqueIndex('profiles_user_idx').on(t.userId),
  })
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appIdx: index('notes_app_idx').on(t.applicationId, t.createdAt),
  })
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    role: text('role'),
    linkedinUrl: text('linkedin_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appIdx: index('contacts_app_idx').on(t.applicationId),
  })
);

export type UserRow = typeof users.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type ApplicationEventRow = typeof applicationEvents.$inferSelect;
