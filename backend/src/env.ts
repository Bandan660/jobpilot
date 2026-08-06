/** Bindings available on the Worker. Secrets come from `wrangler secret put`. */
export interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  /** Resume objects. Keys are user-scoped; see routes/resumes.ts. */
  RESUMES: R2Bucket;
  CORS_ORIGINS: string;
  /** Comma-separated host suffixes, e.g. ".jobpilot-3lg.pages.dev". */
  CORS_ORIGIN_SUFFIXES: string;
  POSTING_RECHECK_AFTER_HOURS: string;
  POSTING_CHECK_BATCH_SIZE: string;
  GHOST_AFTER_DAYS: string;
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

  // The extension's origin is chrome-extension://<id>, and the id differs
  // between the unpacked dev build and the published one.
  if (origin.startsWith('chrome-extension://')) return true;

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
