import type { Config } from 'drizzle-kit';

/**
 * drizzle-kit runs in Node, not in the Worker, so it reads DATABASE_URL from
 * the process environment. Load it from backend/.dev.vars before running
 * `npm run db:push` -- see README for the one-liner.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
} satisfies Config;
