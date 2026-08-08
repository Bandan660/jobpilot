import type { JobAdapter } from './types.js';
import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { ashbyAdapter } from './ashby.js';
import { linkedinAdapter } from './linkedin.js';

/**
 * Adding an ATS means writing an adapter, registering it here, and adding the
 * host to manifest.json's `matches` and `host_permissions`. Nothing else in
 * the extension needs to change.
 */
export const ADAPTERS: JobAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  linkedinAdapter,
];

export function findAdapter(url: URL): JobAdapter | null {
  return ADAPTERS.find((adapter) => adapter.matches(url)) ?? null;
}

export * from './types.js';
