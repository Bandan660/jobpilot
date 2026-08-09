import type { CapturedJob } from '@jobpilot/shared';
import { humanizeSlug, pathSegments, textFrom, type JobAdapter } from './types.js';

/**
 * Lever. URLs are jobs.lever.co/{company}/{postingId}, with an optional
 * /apply suffix for the form itself.
 */
export const leverAdapter: JobAdapter = {
  ats: 'LEVER',
  version: 'lever@1',

  matches(url) {
    return url.hostname === 'jobs.lever.co';
  },

  isJobPage(url) {
    // Needs at least {company}/{postingId}; a bare /{company} is the board.
    return pathSegments(url).length >= 2;
  },

  extract(doc, url) {
    const segments = pathSegments(url);
    const companySlug = segments[0] ?? null;
    const postingId = segments[1] ?? null;

    const logoAlt = doc
      .querySelector<HTMLImageElement>('.main-header-logo img, .posting-logo img')
      ?.alt?.trim();

    const result: Partial<CapturedJob> = {
      title: textFrom(doc, ['.posting-headline h2', '[data-qa="posting-name"]', 'h2']),
      company: logoAlt || (companySlug ? humanizeSlug(companySlug) : null),
      location: textFrom(doc, [
        '.posting-categories .location',
        '.posting-category.location',
        '[class*="location"]',
      ]),
      // Lever posts salary in a dedicated block when the employer supplies one.
      compRaw: textFrom(doc, ['.posting-categories .commitment + .salary', '[class*="salary"]']),
      externalId: postingId,
    };

    // Lever location chips often carry a leading bullet or slash separator.
    if (result.location) {
      result.location = result.location.replace(/^[\s•/|-]+/, '').trim();
    }

    return result;
  },

  descriptionSelectors: ['.section-wrapper.page-full-width', '[data-qa="job-description"]', '.content'],

  confirmationSelectors: ['.application-confirmation', '.postings-confirmation', '#confirmation'],
};
