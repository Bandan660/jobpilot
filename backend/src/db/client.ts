import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
import type { Env } from '../env.js';

export type Database = ReturnType<typeof createDb>;

/**
 * Neon's HTTP driver, not the WebSocket one.
 *
 * Workers cannot hold a TCP connection pool across requests, and each isolate
 * is short-lived, so classic pooling buys nothing here. HTTP also keeps us off
 * `connect()` and inside the free plan's subrequest model.
 */
export function createDb(env: Env) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it to .dev.vars or wrangler secret put.');
  }
  const sql = neon(env.DATABASE_URL);
  return drizzle(sql, { schema });
}

export { schema };
