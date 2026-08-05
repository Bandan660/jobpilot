import type { CapturedJob } from '@jobpilot/shared';
import { humanizeSlug, pathSegments, textFrom, type JobAdapter } from './types.js';

/**
 * Greenhouse.
 *
 * Two live layouts: the legacy boards.greenhouse.io and the newer
 * job-boards.greenhouse.io. Selectors for both are listed together and tried
 * in order rather than branching on hostname -- Greenhouse migrates boards
 * gradually, so hostname is not a reliable signal of which DOM you get.
 */
export const greenhouseAdapter: JobAdapter = {
  ats: 'GREENHOUSE',
  version: 'greenhouse@1',

  matches(url) {
    return url.hostname === 'boards.greenhouse.io' || url.hostname === 'job-boards.greenhouse.io';
  },

  isJobPage(url) {
    // /{company}/jobs/{id} or the embedded /embed/job_app?token=...
    const segments = pathSegments(url);
    if (segments.includes('jobs') && segments.length >= 3) return true;
    return url.pathname.includes('/embed/job_app') && url.searchParams.has('token');
  },

  extract(doc, url) {
    const segments = pathSegments(url);
    const companySlug = segments[0] && segments[0] !== 'embed' ? segments[0] : null;

    const jobsIndex = segments.indexOf('jobs');
    const externalId =
      jobsIndex >= 0 && segments[jobsIndex + 1]
        ? segments[jobsIndex + 1]
        : url.searchParams.get('token');

    const result: Partial<CapturedJob> = {
      title: textFrom(doc, ['h1.app-title', '.job__title h1', '.job__title', 'h1']),
      company:
        textFrom(doc, ['.company-name', '.job__company', '[data-testid="company-name"]']) ??
        (companySlug ? humanizeSlug(companySlug) : null),
      location: textFrom(doc, ['.location', '.job__location', '[class*="location"]']),
      externalId,
    };

    // Legacy boards render "at Acme" in .company-name.
    if (result.company) {
      result.company = result.company.replace(/^at\s+/i, '').trim();
    }

    return result;
  },

  confirmationSelectors: [
    '#application_confirmation',
    '.application-confirmation',
    '[data-testid="application-confirmation"]',
  ],
};
