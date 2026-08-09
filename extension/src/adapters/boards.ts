import { normalizeEmploymentType } from '@jobpilot/shared';
import { defineAdapter, idFromSlug, segmentAfter } from './define.js';
import { pathSegments, textFrom, type JobAdapter } from './types.js';

/**
 * Job boards.
 *
 * Separate from the ATS adapters because the application does not happen here.
 * Almost every posting on these sites ends in an "Apply on company website"
 * link out to a Greenhouse or Workday page — which is where capture-on-submit
 * will fire, through that platform's own adapter.
 *
 * So none of these declare confirmation selectors. What they are for is the
 * other half of the product: reading the posting accurately enough that saving
 * it works and the duplicate warning fires *before* the user clicks through
 * and applies to something they already applied to. That warning is worth more
 * on a board than anywhere else, because a board is where the same role gets
 * seen three times under three different listings.
 *
 * LinkedIn is the exception and has its own file: it owns the Easy Apply form,
 * so the application really is submitted on-site.
 */

/**
 * Naukri. www.naukri.com/job-listings-{slug}-{id}
 *
 * CSS-module class names, hashed per build ("styles_jd-header-title__rZwM1"),
 * so every selector here is a substring match on the readable part. Naukri
 * does emit JobPosting JSON-LD, which is the primary path; this is the
 * fallback for when it does not.
 */
const naukri = defineAdapter({
  version: 'naukri@1',
  hosts: ['www.naukri.com', '.naukri.com'],
  isJobPage: (url) => /^job-listings-/.test(pathSegments(url)[0] ?? ''),
  title: ['[class*="jd-header-title"]', 'h1'],
  company: ['[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]', '[class*="comp-name"]'],
  location: ['[class*="jhc__location"]', '[class*="location"] a', '[class*="loc"] span'],
  comp: ['[class*="salary"]', '[class*="jhc__salary"]'],
  externalId: (url) => idFromSlug(pathSegments(url)[0]),
});

/** www.instahyre.com/job/{id}/{slug} */
const instahyre = defineAdapter({
  version: 'instahyre@1',
  hosts: ['www.instahyre.com', '.instahyre.com'],
  isJobPage: (url) => segmentAfter(url, 'job') !== null,
  title: ['h1', '[class*="job-title"]', '.job-title'],
  company: ['[class*="company-name"]', '.company-name'],
  location: ['[class*="location"]'],
  externalId: (url) => segmentAfter(url, 'job'),
});

/** cutshort.io/job/{slug}-{id} */
const cutshort = defineAdapter({
  version: 'cutshort@1',
  hosts: ['cutshort.io', '.cutshort.io'],
  isJobPage: (url) => segmentAfter(url, 'job') !== null,
  title: ['h1', '[class*="job-title"]'],
  company: ['[class*="company-name"]', '[class*="companyName"]'],
  location: ['[class*="location"]'],
  externalId: (url) => idFromSlug(segmentAfter(url, 'job')),
});

/** www.hirist.tech/j/{slug}-{id} */
const hirist = defineAdapter({
  version: 'hirist@1',
  hosts: ['www.hirist.tech', '.hirist.tech', '.hirist.com'],
  isJobPage: (url) => segmentAfter(url, 'j') !== null,
  title: ['h1', '[class*="job-title"]', '[class*="jobTitle"]'],
  company: ['[class*="company-name"]', '[class*="companyName"]'],
  location: ['[class*="location"]'],
  externalId: (url) => idFromSlug(segmentAfter(url, 'j')),
});

/**
 * Seek. www.seek.com.au/job/{id}
 *
 * `data-automation` is Seek's own test-hook attribute and the most reliable
 * set of selectors of any board here — closer in kind to Workday's than to
 * Naukri's hashed classes.
 */
const seek = defineAdapter({
  version: 'seek@1',
  hosts: ['www.seek.com.au', '.seek.com.au', '.seek.co.nz'],
  isJobPage: (url) => /^\d+$/.test(segmentAfter(url, 'job') ?? ''),
  title: ['[data-automation="job-detail-title"]', 'h1'],
  company: ['[data-automation="advertiser-name"]', '[data-automation="job-header-company-review-title"]'],
  location: ['[data-automation="job-detail-location"]'],
  comp: ['[data-automation="job-detail-salary"]'],
  externalId: (url) => segmentAfter(url, 'job'),
  extra: (doc) => ({
    // Through shared's normalizer rather than a local one: the extension and
    // the API have to agree on these values, and a second mapping here is
    // exactly how they drift.
    employmentType: normalizeEmploymentType(
      textFrom(doc, ['[data-automation="job-detail-work-type"]'], { maxLength: 60 })
    ),
  }),
});

export const BOARD_ADAPTERS: JobAdapter[] = [naukri, instahyre, cutshort, hirist, seek];
