/**
 * Domain contract shared by the extension, API, and web app.
 *
 * Anything here is compiled into all three, so it must stay runtime-agnostic:
 * no Node built-ins, no DOM globals, no Workers globals.
 */

/** Where an application sits in the user's pipeline. */
export const APPLICATION_STATUS = [
  'SAVED',
  'APPLIED',
  'SCREEN',
  'INTERVIEW',
  'OFFER',
  'ACCEPTED',
  'REJECTED',
  'GHOSTED',
  'WITHDRAWN',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUS)[number];

/** Statuses that mean the pipeline has stopped moving, for any reason. */
export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  'ACCEPTED',
  'REJECTED',
  'GHOSTED',
  'WITHDRAWN',
];

/** Statuses where the user is still waiting to hear back. */
export const ACTIVE_STATUSES: readonly ApplicationStatus[] = [
  'APPLIED',
  'SCREEN',
  'INTERVIEW',
  'OFFER',
];

export function isTerminal(status: ApplicationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Liveness of the job posting itself. Deliberately separate from
 * ApplicationStatus: a posting going down is evidence about the role, not a
 * decision about the candidate. The dead-posting worker writes this; it never
 * writes ApplicationStatus directly.
 */
export const POSTING_STATUS = ['LIVE', 'REMOVED', 'CLOSED', 'UNKNOWN'] as const;
export type PostingStatus = (typeof POSTING_STATUS)[number];

/** ATS platforms we have (or plan to have) a capture adapter for. */
export const ATS_PROVIDER = [
  'GREENHOUSE',
  'LEVER',
  'ASHBY',
  'WORKDAY',
  'ICIMS',
  'SMARTRECRUITERS',
  'GENERIC',
] as const;
export type AtsProvider = (typeof ATS_PROVIDER)[number];

/** How an application entered the system. */
export const APPLICATION_SOURCE = [
  'EXTENSION_AUTO',
  'EXTENSION_MANUAL',
  'WEB_MANUAL',
  'IMPORT',
] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCE)[number];

/**
 * Append-only audit log. Every state change lands here, whatever caused it.
 *
 * This is the extension point for Gmail-driven status updates: an email
 * ingester adds EMAIL to EventActor and writes STATUS_CHANGED events like any
 * other source. No schema change needed when that ships.
 */
export const EVENT_TYPE = [
  'CREATED',
  'STATUS_CHANGED',
  'POSTING_CHECKED',
  'NOTE_ADDED',
  'CONTACT_ADDED',
  'DUPLICATE_FLAGGED',
  'FOLLOW_UP_DUE',
] as const;
export type EventType = (typeof EVENT_TYPE)[number];

/** Who or what produced an event. */
export const EVENT_ACTOR = ['USER', 'EXTENSION', 'SYSTEM', 'EMAIL'] as const;
export type EventActor = (typeof EVENT_ACTOR)[number];

export interface Company {
  id: string;
  /** Display name as captured, e.g. "Stripe, Inc." */
  name: string;
  /** Match key from normalizeCompany(), e.g. "stripe". Unique. */
  slug: string;
  domain: string | null;
}

export interface Application {
  id: string;
  userId: string;
  companyId: string;
  company: Pick<Company, 'id' | 'name' | 'slug' | 'domain'>;

  title: string;
  /** Match key from normalizeTitle(). Used with company slug for dedupe. */
  titleSlug: string;
  location: string | null;
  remote: boolean | null;

  /** Original posting URL, exactly as captured. */
  jobUrl: string | null;
  /** canonicalizeJobUrl(jobUrl). Primary dedupe key. */
  jobUrlCanonical: string | null;
  /** ATS-native posting id, when the adapter can extract one. */
  externalId: string | null;
  ats: AtsProvider | null;

  /** Posted compensation, in minor units (cents) to avoid float drift. */
  compMinCents: number | null;
  compMaxCents: number | null;
  compCurrency: string | null;
  compRaw: string | null;

  status: ApplicationStatus;
  source: ApplicationSource;

  /** Hidden from the default view, but still counted in stats. */
  archived: boolean;
  starred: boolean;

  appliedAt: string | null;
  /** First inbound response of any kind. Null means still waiting. */
  firstResponseAt: string | null;

  postingStatus: PostingStatus;
  postingCheckedAt: string | null;
  /** Consecutive failed checks. Two strikes before we mark a posting dead. */
  postingCheckFailures: number;

  createdAt: string;
  updatedAt: string;
}

export interface ApplicationEvent {
  id: string;
  applicationId: string;
  type: EventType;
  actor: EventActor;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus | null;
  /** Free-form per-event detail. Shape varies by type and adapter. */
  payload: Record<string, unknown> | null;
  occurredAt: string;
}

export interface Note {
  id: string;
  applicationId: string;
  body: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  applicationId: string;
  name: string;
  email: string | null;
  role: string | null;
  linkedinUrl: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Wire payloads                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What a content-script adapter scrapes off a job page.
 * Every field past `jobUrl` is best-effort — adapters return what they find.
 */
export interface CapturedJob {
  jobUrl: string;
  title: string | null;
  company: string | null;
  location: string | null;
  remote: boolean | null;
  externalId: string | null;
  ats: AtsProvider;
  compRaw: string | null;
  /** Adapter version, so we can tell stale captures apart after a site redesign. */
  adapterVersion: string;
}

/** Extension -> POST /api/capture */
export interface CaptureRequest {
  job: CapturedJob;
  /** True when we detected a real submit; false for a manual bookmark. */
  applied: boolean;
  /** Client-side capture time, ISO 8601. Server clamps implausible values. */
  capturedAt: string;
}

export interface CaptureResponse {
  application: Application;
  /** True when this call created a row rather than updating one. */
  created: boolean;
  /** Prior applications that look like the same role. Drives the dupe warning. */
  duplicates: DuplicateMatch[];
}

/** Extension -> POST /api/applications/check-duplicate, before the user applies. */
export interface DuplicateCheckRequest {
  jobUrl: string;
  company: string | null;
  title: string | null;
}

export type DuplicateConfidence = 'EXACT_URL' | 'EXACT_ROLE' | 'SAME_COMPANY';

export interface DuplicateMatch {
  applicationId: string;
  confidence: DuplicateConfidence;
  title: string;
  companyName: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  daysAgo: number | null;
}

export interface DuplicateCheckResponse {
  matches: DuplicateMatch[];
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: { id: string; email: string; createdAt: string };
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                       */
/* -------------------------------------------------------------------------- */

export interface FunnelStats {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  /** Share of applied roles that got any response. 0..1. */
  responseRate: number;
  /** Median days to first response, over applications that got one. */
  medianDaysToResponse: number | null;
  /** Applied, no response, posting gone or 30+ days silent. */
  ghostedCount: number;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
