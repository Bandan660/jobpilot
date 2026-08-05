import type { CapturedJob } from '@jobpilot/shared';
import { humanizeSlug, pathSegments, textFrom, type JobAdapter } from './types.js';

/**
 * Ashby. A client-rendered SPA, so the DOM is unstable and class names are
 * hashed -- this adapter leans hardest on JSON-LD and treats selectors as a
 * thin fallback. It is also why the content script waits for the posting to
 * render rather than reading at document_idle.
 */
export const ashbyAdapter: JobAdapter = {
  ats: 'ASHBY',
  version: 'ashby@1',

  matches(url) {
    return url.hostname === 'jobs.ashbyhq.com';
  },

  isJobPage(url) {
    // {company}/{uuid}; the bare /{company} route is the board.
    const segments = pathSegments(url);
    if (segments.length < 2) return false;
    // Ashby posting ids are UUIDs.
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segments[1]);
  },

  extract(doc, url) {
    const segments = pathSegments(url);
    const companySlug = segments[0] ?? null;

    return {
      title: textFrom(doc, ['h1', '[class*="jobPostingHeader"] h1']),
      company:
        textFrom(doc, ['[class*="companyName"]', 'header a[href="/"]']) ??
        (companySlug ? humanizeSlug(companySlug) : null),
      location: textFrom(doc, ['[class*="jobPostingHeaderSubtitle"]', '[class*="location"]']),
      compRaw: textFrom(doc, ['[class*="compensation"]', '[class*="salary"]']),
      externalId: segments[1] ?? null,
    } satisfies Partial<CapturedJob>;
  },

  confirmationSelectors: ['[class*="applicationConfirmation"]', '[class*="submitted"]'],
};
