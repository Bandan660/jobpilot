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
/**
 * Strips a leading byte-order mark and surrounding whitespace.
 *
 * Secrets routinely arrive with a BOM: copying from a file saved as UTF-8-with-
 * BOM, or piping through a shell that re-encodes stdout, both prepend one. It
 * is invisible in every UI that shows the value back to you, and the resulting
 * error — "not a valid URL", quoting a connection string that looks perfectly
 * correct — sends you hunting in the wrong place.
 *
 * Cheap to defend against, expensive to diagnose.
 */
function cleanSecret(value: string | undefined): string {
  return (value ?? '').replace(/^﻿/, '').trim();
}

export function createDb(env: Env) {
  const url = cleanSecret(env.DATABASE_URL);

  if (!url) {
    throw new Error('DATABASE_URL is not set. Add it to .dev.vars or wrangler secret put.');
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      `DATABASE_URL does not look like a Postgres connection string (starts with "${url.slice(0, 12)}")`
    );
  }

  const sql = neon(url);
  return drizzle(sql, { schema });
}

export { cleanSecret };

export { schema };
