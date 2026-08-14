/** Bindings available on the Worker. Secrets come from `wrangler secret put`. */
export interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  /** Resume objects. Keys are user-scoped; see routes/resumes.ts. */
  /**
   * Gemini key for match analysis. Absent until `wrangler secret put
   * GEMINI_API_KEY` has been run; the route 503s rather than crashing.
   */
  GEMINI_API_KEY?: string;
  /** Absent until R2 is enabled on the account; routes 503 rather than crash. */
  RESUMES?: R2Bucket;
  CORS_ORIGINS: string;
  /** Comma-separated host suffixes, e.g. ".jobpilot-3lg.pages.dev". */
  CORS_ORIGIN_SUFFIXES: string;
  POSTING_RECHECK_AFTER_HOURS: string;
  POSTING_CHECK_BATCH_SIZE: string;
  GHOST_AFTER_DAYS: string;
  /**
   * Comma-separated emails allowed to read the admin metrics.
   *
   * Optional, and absent means nobody — see `requireAdmin`. Deliberately not a
   * database column: there is then nothing in the database that can be edited
   * to grant admin, and revoking is a deploy rather than a query.
   */
  ADMIN_EMAILS?: string;
  /**
   * Firebase project id. Not a secret — it appears in the client config — but
   * it is the audience every ID token is checked against, so a wrong or empty
   * value is the difference between verifying tokens and accepting anyone's.
   * `/api/auth/firebase` 503s rather than guessing when it is unset.
   */
  FIREBASE_PROJECT_ID?: string;
  /**
   * Comma-separated Chrome extension ids allowed as CORS origins.
   *
   * Optional. Absent means "any extension origin", which is where this started
   * — see `isAllowedOrigin` for why that is survivable and still worth
   * narrowing. Set it to the published id once the Web Store listing exists.
   */
  EXTENSION_IDS?: string;
}

/** Hono context typing used across every route module. */
export type AppContext = {
  Bindings: Env;
  Variables: {
    userId: string;
  };
};

export function numberVar(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsOrigins(env: Env): string[] {
  return list(env.CORS_ORIGINS);
}

/**
 * Admin emails, lowercased.
 *
 * Lowercased here rather than at each call site because the users table
 * indexes email case-insensitively, so a secret written with different casing
 * than the signup would otherwise lock the owner out of their own dashboard.
 */
export function adminEmails(env: Env): string[] {
  return list(env.ADMIN_EMAILS).map((email) => email.toLowerCase());
}

/**
 * Decides whether a browser origin may call this API.
 *
 * Exact matches come from CORS_ORIGINS. Suffix matches exist for Cloudflare
 * Pages preview deployments, which get a per-build hostname
 * (<hash>.jobpilot-3lg.pages.dev) that cannot be enumerated in advance.
 *
 * The suffix must include the leading dot and the project's own subdomain.
 * ".jobpilot-3lg.pages.dev" only ever matches deployments of that project —
 * nobody else can be issued that hostname, and a lookalike such as
 * "evil-jobpilot-3lg.pages.dev" does not end with it. A bare ".pages.dev"
 * would let any Pages site on the internet call this API, so never configure
 * one.
 */
export function isAllowedOrigin(origin: string, env: Env): boolean {
  if (!origin) return false;

  /*
   * The extension's origin is chrome-extension://<id>, and the id differs
   * between the unpacked dev build and the published one.
   *
   * Once EXTENSION_IDS is set, only those ids are allowed. Until then any
   * extension origin passes, which is how this started and is worth being
   * precise about: CORS is not what protects this API — every route needs a
   * bearer token, and another extension cannot read this one's storage — so
   * the permissive branch grants a stranger's extension nothing it could not
   * get by calling the API from its own background worker, which CORS does not
   * govern at all. It is still narrower to name the ids, and once the Web Store
   * listing exists there is no reason not to.
   */
  if (origin.startsWith('chrome-extension://')) {
    const allowed = list(env.EXTENSION_IDS);
    if (allowed.length === 0) return true;
    return allowed.some((id) => origin === `chrome-extension://${id}`);
  }

  if (corsOrigins(env).includes(origin)) return true;

  let host: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    host = url.hostname;
  } catch {
    return false;
  }

  return list(env.CORS_ORIGIN_SUFFIXES).some(
    (suffix) => suffix.startsWith('.') && host.endsWith(suffix)
  );
}
