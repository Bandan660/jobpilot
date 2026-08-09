import type { CapturedJob } from '@jobpilot/shared';
import { cleanJobTitle, looksLikeTitle } from './define.js';
import {
  labelledValue,
  metaFrom,
  remoteFromLocation,
  textFrom,
  type JobAdapter,
} from './types.js';
import { hasJobPosting } from './jsonld.js';

/**
 * The fallback, and the reason the others can be narrow.
 *
 * This existing changes the failure mode of an unrecognised host. `findAdapter`
 * returned null there, `init` returned early, and the extension did nothing at
 * all — not the JSON-LD read it was documented as falling back to, because
 * nothing was left to carry it. Every site in manifest.json without an adapter
 * of its own was a silent no-op.
 *
 * WHY IT IS SAFE TO MATCH EVERYTHING
 *
 * Two bounds. The content script only runs on the hosts manifest.json lists,
 * so "everything" is those hosts and no others. And `isJobPage` demands a
 * schema.org JobPosting in the document rather than guessing from the URL —
 * a claim the page makes about itself, in markup it publishes for Google Jobs.
 * A careers index, a search page, and jobpilot's own site all fail that test,
 * which is what keeps the panel from appearing where there is nothing to save.
 *
 * That means no JSON-LD, no capture. Correct: with no structured data and no
 * platform knowledge, anything this could scrape would be a guess, and a
 * wrong row in someone's tracker is worse than an absent one.
 */
export const genericAdapter: JobAdapter = {
  ats: 'GENERIC',
  version: 'generic@1',

  /** Registered last, so this only ever sees what nothing else claimed. */
  matches() {
    return true;
  },

  /*
   * Reads the live document rather than the URL. The interface passes only the
   * URL because every other adapter can tell from the path alone; here there
   * is no path convention to know, and the markup is the only evidence.
   */
  isJobPage() {
    return hasJobPosting(document);
  },

  /**
   * Deliberately thin.
   *
   * content.ts merges JSON-LD over this and JSON-LD wins every field, so what
   * is left to do is cover the two things a posting sometimes omits from its
   * structured data while still displaying them.
   */
  extract(doc) {
    const company = metaFrom(doc, ['og:site_name']);
    const rawTitle = textFrom(doc, ['h1'], { maxLength: 200 }) ?? metaFrom(doc, ['og:title']);
    const location = labelledValue(doc, ['location', 'job location', 'locations']);
    const title = rawTitle ? cleanJobTitle(rawTitle, company) : '';

    return {
      title: looksLikeTitle(title, company) ? title : null,
      company,
      location,
      remote: remoteFromLocation(location),
    } satisfies Partial<CapturedJob>;
  },

  confirmationSelectors: [],
};
