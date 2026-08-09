import { normalizeEmploymentType, type CapturedJob } from '@jobpilot/shared';
import {
  hostMatches,
  pathSegments,
  remoteFromLocation,
  squish,
  tenantFromHost,
  textFrom,
  attrFrom,
  type JobAdapter,
} from './types.js';

/**
 * Workday.
 *
 * The one platform here where the adapter is the entire story: Workday emits
 * no JobPosting JSON-LD, so nothing is captured on the largest enterprise ATS
 * in the list unless these selectors work.
 *
 * They are `data-automation-id` attributes, which is the best hook any ATS in
 * this codebase offers. Workday's own UI tests depend on them, so unlike a
 * hashed class name they do not churn with a redesign. Class names are not
 * used here at all.
 *
 * URL shapes, all tenant-hosted:
 *   {tenant}.wd{n}.myworkdayjobs.com/{locale}/{site}/job/{place}/{title}_{REQ}
 *   {tenant}.wd{n}.myworkdayjobs.com/{locale}/{site}/details/{title}_{REQ}
 *   …/job/{place}/{title}_{REQ}/apply/applyManually
 *
 * Newer tenants also serve on myworkdaysite.com. That host is deliberately not
 * matched: it is absent from manifest.json, so the content script never runs
 * there and an adapter claiming it would be dead code. Adding it means adding
 * the match pattern first.
 */

/** "Software-Engineer_JR-12345" -> "JR-12345". */
function requisitionFromPath(url: URL): string | null {
  const last = pathSegments(url)
    .filter((segment) => segment !== 'apply' && !segment.startsWith('apply'))
    .pop();
  if (!last) return null;

  const underscore = last.lastIndexOf('_');
  if (underscore < 0) return null;

  const requisition = decodeURIComponent(last.slice(underscore + 1));
  return requisition || null;
}

/**
 * Strip a label Workday renders inside the value.
 *
 * The metadata blocks are `<dt>locations</dt><dd …>Bengaluru</dd>` in some
 * tenants and a single element reading "locations Bengaluru" in others,
 * because the same component is themed per site.
 */
function stripLabel(value: string | null, label: RegExp): string | null {
  if (!value) return null;
  const cleaned = squish(value.replace(label, ''));
  return cleaned || null;
}

export const workdayAdapter: JobAdapter = {
  ats: 'WORKDAY',
  version: 'workday@1',

  matches(url) {
    return hostMatches(url, ['.myworkdayjobs.com']);
  },

  isJobPage(url) {
    const segments = pathSegments(url);
    return segments.includes('job') || segments.includes('details');
  },

  extract(doc, url) {
    const location = stripLabel(
      textFrom(
        doc,
        [
          '[data-automation-id="locations"] dd',
          '[data-automation-id="locations"]',
          '[data-automation-id="location"]',
          '[data-automation-id="jobPostingLocation"]',
        ],
        { maxLength: 160 }
      ),
      /^locations?\s*/i
    );

    const timeType = stripLabel(
      textFrom(doc, ['[data-automation-id="time"] dd', '[data-automation-id="time"]'], {
        maxLength: 80,
      }),
      /^time\s*type\s*/i
    );

    const requisition = stripLabel(
      textFrom(doc, ['[data-automation-id="requisitionId"]'], { maxLength: 80 }),
      /^(job\s*)?(requisition\s*)?id\s*/i
    );

    /*
     * Company. Workday's chrome carries the employer's logo but rarely their
     * name as text, so the logo's alt text is tried before falling back to the
     * tenant label in the hostname — which is present on every Workday URL and
     * is the reason this field is reliable at all here.
     */
    const logoAlt = attrFrom(
      doc,
      [
        '[data-automation-id="companyLogo"] img',
        '[data-automation-id="companyLogo"]',
        'header img[alt]',
      ],
      'alt'
    );
    const company =
      (logoAlt ? squish(logoAlt.replace(/\s*(logo|careers?)\s*$/i, '')) : null) ||
      tenantFromHost(url);

    return {
      title: textFrom(
        doc,
        [
          '[data-automation-id="jobPostingHeader"]',
          '[data-automation-id="jobTitle"]',
          'h1',
          'h2',
        ],
        { maxLength: 200 }
      ),
      company,
      location,
      remote: remoteFromLocation(location),
      employmentType: normalizeEmploymentType(timeType),
      externalId: requisition ?? requisitionFromPath(url),
    } satisfies Partial<CapturedJob>;
  },

  /**
   * The requisition id is in the URL and in the DOM, and they are the same
   * string. Workday's candidate site is a single-page app that swaps postings
   * under a changed URL exactly the way LinkedIn's does, so the pair is worth
   * comparing.
   */
  expectedExternalId(url) {
    return requisitionFromPath(url);
  },

  renderedExternalId(doc) {
    return stripLabel(
      textFrom(doc, ['[data-automation-id="requisitionId"]'], { maxLength: 80 }),
      /^(job\s*)?(requisition\s*)?id\s*/i
    );
  },

  confirmationSelectors: [
    '[data-automation-id="applicationSubmitted"]',
    '[data-automation-id="successBanner"]',
    '[data-automation-id="confirmationPage"]',
  ],
};
