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
 * Every adapter, always. What *runs* is decided elsewhere.
 *
 * This list used to be trimmed to the shipping platforms, which was the wrong
 * lever: a content script that never executes on a host cannot be reached by
 * `findAdapter` in the first place, and trimming here only meant that a
 * platform the user later enabled would fall through to `genericAdapter`
 * instead of the adapter written for it.
 *
 * Where the extension may run is decided by permissions —
 * `content_scripts.matches` for the three that ship enabled (LinkedIn, Indeed,
 * Naukri), and `optional_host_permissions` plus a granted request for the
 * rest. `platforms.ts` owns that, and is the file to edit when adding one.
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
