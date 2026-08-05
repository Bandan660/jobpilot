/** Bindings available on the Worker. Secrets come from `wrangler secret put`. */
export interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  CORS_ORIGINS: string;
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

export function corsOrigins(env: Env): string[] {
  return (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
