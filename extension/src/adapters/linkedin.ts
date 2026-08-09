import type { CapturedJob } from '@jobpilot/shared';
import { textFrom, type JobAdapter } from './types.js';

/**
 * LinkedIn.
 *
 * Different from every other adapter here, in three ways that shape all of it.
 *
 * THE JOB ID IS USUALLY IN A QUERY PARAM, NOT THE PATH
 *
 * `/jobs/view/{id}` exists, but most browsing happens in the split view at
 * `/jobs/search`, `/jobs/collections/...` or `/my-items/saved-jobs`, where the
 * posting on the right is identified by `?currentJobId=`. Clicking a different
 * result changes only that parameter, so the id has to be read from both
 * places or the panel shows the first job you opened for the rest of the
 * session.
 *
 * THE MARKUP IS OBFUSCATED AND UNSTABLE
 *
 * LinkedIn ships hashed class names that change without notice, so selectors
 * lean on `data-*` hooks and ARIA where they exist, and every field has
 * several fallbacks ending in something structural. Expect this adapter to
 * need maintenance more often than Greenhouse or Lever — that is a property of
 * the site, not something a better selector fixes.
 *
 * EASY APPLY IS A MODAL, NOT A PAGE
 *
 * There is no navigation and no separate URL. The form appears in a dialog
 * over the posting, runs several steps, and the DOM is replaced between them.
 * Detection therefore watches for the dialog rather than the location, which
 * is what `easyApplyModal` is for.
 */

/** The Easy Apply dialog, if it is currently open. */
export function easyApplyModal(): HTMLElement | null {
  const candidates = [
    '.jobs-easy-apply-modal',
    '[data-test-modal][role="dialog"]',
    'div[role="dialog"][aria-labelledby*="easy-apply"]',
    'div[role="dialog"]',
  ];

  for (const selector of candidates) {
    const el = document.querySelector<HTMLElement>(selector);
    // A dialog with no inputs is a confirmation or a share sheet, not the form.
    if (el && el.querySelector('input, select, textarea')) return el;
  }
  return null;
}

function jobIdFrom(url: URL): string | null {
  const fromQuery = url.searchParams.get('currentJobId');
  if (fromQuery) return fromQuery;

  // /jobs/view/4012345678/ — the id is the segment after "view".
  const match = url.pathname.match(/\/jobs\/view\/(\d+)/);
  return match?.[1] ?? null;
}

export const linkedinAdapter: JobAdapter = {
  ats: 'LINKEDIN',
  version: 'linkedin@1',

  matches(url) {
    return url.hostname === 'www.linkedin.com' || url.hostname === 'linkedin.com';
  },

  isJobPage(url) {
    if (!url.pathname.startsWith('/jobs')) {
      // Saved jobs lives outside /jobs but uses the same split view.
      if (!url.pathname.startsWith('/my-items')) return false;
    }
    return jobIdFrom(url) !== null;
  },

  expectedExternalId(url) {
    return jobIdFrom(url);
  },

  /**
   * The id the detail pane is currently rendering.
   *
   * Read from the DOM, never the URL — the whole point is catching the window
   * where the two disagree. LinkedIn exposes it as a data attribute on the
   * pane and, failing that, in the "save"/"apply" controls and any
   * /jobs/view/{id} link inside the pane.
   */
  renderedExternalId(doc) {
    const pane =
      doc.querySelector('.jobs-search__job-details') ??
      doc.querySelector('.job-view-layout') ??
      doc.querySelector('main');
    if (!pane) return null;

    const attributed = pane.querySelector('[data-job-id], [data-occludable-job-id]');
    const fromAttr =
      attributed?.getAttribute('data-job-id') ??
      attributed?.getAttribute('data-occludable-job-id') ??
      null;
    if (fromAttr && /^\d+$/.test(fromAttr)) return fromAttr;

    const link = pane.querySelector<HTMLAnchorElement>('a[href*="/jobs/view/"]');
    const fromLink = link?.getAttribute('href')?.match(/\/jobs\/view\/(\d+)/)?.[1];
    return fromLink ?? null;
  },

  extract(doc, url) {
    /*
     * Scope every lookup to the detail pane when there is one. In split view
     * the left column holds dozens of other postings' titles and companies,
     * and an unscoped querySelector reliably returns the wrong one.
     */
    const pane =
      doc.querySelector('.jobs-search__job-details') ??
      doc.querySelector('.jobs-details__main-content') ??
      doc.querySelector('.job-view-layout') ??
      doc.querySelector('main') ??
      doc;

    const title = textFrom(pane as Element, [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.jobs-unified-top-card__job-title',
      '.job-details-jobs-unified-top-card__job-title',
      '.topcard__title',
      'h1',
    ]);

    /*
     * The last two entries are the durable ones.
     *
     * Every class above them is hashed and rotates; a link to /company/{slug}
     * is how LinkedIn's own navigation works and has outlived every redesign.
     * It is scoped to a top-card container first because in split view the
     * left-hand results list is full of other postings' company links, and an
     * unscoped match returns whichever one happens to be first in the DOM.
     */
    const company = textFrom(pane as Element, [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      '[data-tracking-control-name="public_jobs_topcard-org-name"]',
      '[class*="top-card"] a[href*="/company/"]',
      'a[href*="/company/"]',
    ]);

    /*
     * The subtitle line reads "Bengaluru, India · 2 weeks ago · 40 applicants".
     * Only the first part is a location; the rest is recency and social proof
     * that would otherwise end up stored as the location.
     */
    const rawLocation = textFrom(pane as Element, [
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.job-details-jobs-unified-top-card__bullet',
      '.jobs-unified-top-card__bullet',
      '.topcard__flavor--bullet',
    ]);
    const location = rawLocation ? (rawLocation.split('·')[0]?.trim() ?? null) : null;

    /*
     * Last resort: the document title and og:title.
     *
     * LinkedIn writes "Acme hiring Software Engineer in Bengaluru | LinkedIn",
     * which survives every class-name change the site has ever made. Without
     * this, one renamed hashed class means no title, no company, and
     * buildJob() discards the page entirely — the extension goes silent rather
     * than degrading.
     */
    let fallbackTitle: string | null = null;
    let fallbackCompany: string | null = null;

    if (!title || !company) {
      const meta = doc
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content')
        ?.trim();
      const raw = (meta || doc.title || '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();

      // Strip the unread-message counter LinkedIn prefixes: "(21) ".
      const cleaned = raw.replace(/^\(\d+\)\s*/, '');

      const hiring = cleaned.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
      if (hiring) {
        fallbackCompany = hiring[1]?.trim() ?? null;
        fallbackTitle = hiring[2]?.trim() ?? null;
      } else if (cleaned && !/^jobs?$/i.test(cleaned)) {
        fallbackTitle = cleaned;
      }
    }

    const result: Partial<CapturedJob> = {
      title: title ?? fallbackTitle,
      company: (company ?? fallbackCompany)?.replace(/\s+/g, ' ').trim() ?? null,
      location,
      externalId: jobIdFrom(url),
    };

    return result;
  },

  /*
   * Post-submit, LinkedIn swaps the dialog for a "Your application was sent"
   * panel. There is no navigation, so these are what the submit watcher has to
   * go on.
   */
  confirmationSelectors: [
    // Deliberately NOT .artdeco-inline-feedback--success: that is LinkedIn's
    // generic success toast and fires for "Job saved" among others, which
    // would record an application nobody submitted.
    '.jobs-easy-apply-content__success',
    '.post-apply-timeline',
    '[data-test-modal] h2[id*="post-apply"]',
  ],

  confirmationScope() {
    // Only the dialog counts. Outside it, "Application submitted" is a status
    // label on some other posting in the list.
    return (
      document.querySelector('.jobs-easy-apply-modal') ??
      document.querySelector('div[role="dialog"]') ??
      document.querySelector('.post-apply-timeline')
    );
  },
};
