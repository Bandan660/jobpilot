import type { JobAdapter } from './types.js';
import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { ashbyAdapter } from './ashby.js';
import { linkedinAdapter } from './linkedin.js';
import { workdayAdapter } from './workday.js';
import { ATS_ADAPTERS } from './ats.js';
import { BOARD_ADAPTERS } from './boards.js';
import { genericAdapter } from './generic.js';

/**
 * Adding an ATS means writing an adapter, registering it here, and adding the
 * host to manifest.json's `matches`. Nothing else in the extension changes.
 *
 * ORDER MATTERS. `findAdapter` takes the first match, and `genericAdapter`
 * matches everything — it is the fallback for hosts nothing else claims, so it
 * must stay last. Anything registered after it is unreachable.
 */
export const ADAPTERS: JobAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  linkedinAdapter,
  workdayAdapter,
  ...ATS_ADAPTERS,
  ...BOARD_ADAPTERS,
  genericAdapter,
];

export function findAdapter(url: URL): JobAdapter | null {
  return ADAPTERS.find((adapter) => adapter.matches(url)) ?? null;
}

export * from './types.js';
