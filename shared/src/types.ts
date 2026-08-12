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
  /*
   * LinkedIn is a job board rather than an ATS, but it owns the application
   * flow for Easy Apply postings, which is what matters here: the form lives
   * on linkedin.com and the application is submitted there.
   */
  'LINKEDIN',
  'GENERIC',
] as const;
export type AtsProvider = (typeof ATS_PROVIDER)[number];

/**
 * Employment type.
 *
 * Values match schema.org's JobPosting employmentType, so a posting that
 * declares it is captured rather than guessed. INTERN and CONTRACTOR are
 * spelled the way the spec spells them, not the way a form label would.
 */
export const EMPLOYMENT_TYPE = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACTOR',
  'TEMPORARY',
  'INTERN',
  'VOLUNTEER',
  'PER_DIEM',
  'OTHER',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPE)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACTOR: 'Contract',
  TEMPORARY: 'Temporary',
  INTERN: 'Internship',
  VOLUNTEER: 'Volunteer',
  PER_DIEM: 'Per diem',
  OTHER: 'Other',
};

/** Maps the many spellings found in the wild onto the enum. */
export function normalizeEmploymentType(raw: string | null | undefined): EmploymentType | null {
  if (!raw) return null;
  const value = raw.toUpperCase().replace(/[\s-]+/g, '_');

  if (/FULL/.test(value)) return 'FULL_TIME';
  if (/PART/.test(value)) return 'PART_TIME';
  if (/CONTRACT|FREELANCE|C2H/.test(value)) return 'CONTRACTOR';
  if (/INTERN/.test(value)) return 'INTERN';
  if (/TEMP/.test(value)) return 'TEMPORARY';
  if (/VOLUNTEER/.test(value)) return 'VOLUNTEER';
  if (/PER_DIEM/.test(value)) return 'PER_DIEM';
  return null;
}

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
  employmentType: EmploymentType | null;

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
  /** Which resume was sent with this application, if one was recorded. */
  resumeId: string | null;

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

/**
 * An uploaded resume.
 *
 * The file lives in object storage; this row is the record of it. `key` is
 * never sent to a client — objects are always served through an endpoint that
 * checks ownership first, so knowing a key is worth nothing on its own.
 */
export interface Resume {
  id: string;
  userId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** The one attached to new applications unless another is chosen. */
  isDefault: boolean;
  uploadedAt: string;
}

/** Types worth accepting. Anything else is rejected before it reaches storage. */
export const RESUME_CONTENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/*
 * 200KB.
 *
 * Tight on purpose. A resume exported straight from a word processor is
 * usually 150-400KB because it embeds full font files; the same document
 * printed to PDF with subsetted fonts is nearer 60KB and identical to read.
 *
 * The trade is deliberate: some legitimate PDFs will be refused, so the error
 * has to say how to fix it rather than just stating the limit.
 */
export const MAX_RESUME_BYTES = 200 * 1024;

/*
 * One per account. Uploading again replaces what is there.
 *
 * A resume is not a document people want versions of inside a tracker — they
 * keep those where they wrote it. Storing one means autofill never has to
 * guess which to attach, and the storage question stops being interesting:
 * one user is 200KB, ten thousand are 2GB.
 */
export const MAX_RESUMES_PER_USER = 1;

/*
 * Hard ceiling across every account, well under R2's free 10GB.
 *
 * Per-account limits bound one user; they do nothing about a thousand of them.
 * The headroom matters because R2 bills the moment the free tier is crossed,
 * with no warning and no way to decline — so the API refuses new uploads while
 * there is still a gigabyte spare, rather than discovering the overage on an
 * invoice.
 */
export const MAX_TOTAL_STORAGE_BYTES = 9 * 1024 * 1024 * 1024;

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
  employmentType: EmploymentType | null;
  externalId: string | null;
  ats: AtsProvider;
  compRaw: string | null;
  /** Adapter version, so we can tell stale captures apart after a site redesign. */
  adapterVersion: string;
}

/**
 * Field limits for a captured job, in one place.
 *
 * The API validates against these and the extension clamps to them before
 * sending. Two copies of the same number is how a scrape that is merely long
 * becomes a 400 the user can do nothing about: a Workday posting listing
 * fourteen offices produces a location string well past 200 characters, and
 * "Invalid capture payload: job.location String must contain at most 200
 * character(s)" is not a sentence anyone can act on.
 *
 * Clamping rather than rejecting is deliberate. A truncated location is still
 * a useful record of where the job was; a refused save is not a record at all.
 */
export const CAPTURE_LIMITS = {
  jobUrl: 2048,
  title: 300,
  company: 200,
  location: 200,
  externalId: 200,
  compRaw: 500,
  adapterVersion: 50,
} as const;

/**
 * Cut every field to what the API will accept.
 *
 * Runs in the extension immediately before send. Truncation is marked with an
 * ellipsis so a clipped value is visibly clipped rather than looking like the
 * posting said something shorter than it did.
 */
export function clampCapturedJob(job: CapturedJob): CapturedJob {
  const cut = (value: string | null, limit: number): string | null => {
    if (value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
  };

  return {
    ...job,
    // Not truncated: a cut URL is a broken URL, and every downstream use of
    // this field — canonicalization, the sweep worker, the tracker link —
    // needs it whole. Over the limit it is dropped to the origin, which at
    // least still resolves.
    jobUrl:
      job.jobUrl.length <= CAPTURE_LIMITS.jobUrl ? job.jobUrl : safeOrigin(job.jobUrl),
    title: cut(job.title, CAPTURE_LIMITS.title),
    company: cut(job.company, CAPTURE_LIMITS.company),
    location: cut(job.location, CAPTURE_LIMITS.location),
    externalId: cut(job.externalId, CAPTURE_LIMITS.externalId),
    compRaw: cut(job.compRaw, CAPTURE_LIMITS.compRaw),
    adapterVersion: job.adapterVersion.slice(0, CAPTURE_LIMITS.adapterVersion),
  };
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.slice(0, CAPTURE_LIMITS.jobUrl);
  }
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

/* -------------------------------------------------------------------------- */

/**
 * Service-wide aggregates for the admin dashboard.
 *
 * Counts only, deliberately. Nothing here identifies a person — no email, no
 * job title, no company, no id — which is what keeps the privacy policy true
 * and keeps a compromised admin session from being a breach of anyone's job
 * search. Adding "just one" identifying field turns a metrics page into a user
 * directory; that would be a different feature with a different disclosure.
 */
export interface AdminMetrics {
  users: { total: number; last7: number; last30: number };
  applications: { total: number; last7: number; last30: number; withResume: number };
  /** Signups per day for the last 30 days, oldest first. Empty days included as zero. */
  signups: { date: string; count: number }[];
  platforms: { ats: string; count: number }[];
  statuses: { status: string; count: number }[];
  postings: { status: string; count: number }[];
  /** Accounts with at least one application. */
  activatedUsers: number;
}

/* -------------------------------------------------------------------------- */
/* Blog Management                                                             */
/* -------------------------------------------------------------------------- */

export interface DynamicBlogPost {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  author: string;
  readingMinutes: number;
  tags: string[];
  content: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBlogPostInput {
  title: string;
  slug?: string;
  summary: string;
  category?: string;
  author?: string;
  readingMinutes?: number;
  tags?: string[];
  content: string;
  published?: boolean;
}
