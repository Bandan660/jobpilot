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
  isJobPage: (url) =>
    /^job-listings-/.test(pathSegments(url)[0] ?? '') ||
    url.pathname.includes('job-listings') ||
    url.pathname.includes('job-overview'),
  title: ['[class*="jd-header-title"]', '[class*="title"] h1', 'h1'],
  company: [
    '[class*="jd-header-comp-name"] a',
    '[class*="jd-header-comp-name"]',
    '[class*="comp-name"]',
    '[class*="companyName"]',
  ],
  location: [
    '[class*="jhc__location"]',
    '[class*="location"] a',
    '[class*="loc"] span',
    '[class*="location"]',
  ],
  comp: ['[class*="salary"]', '[class*="jhc__salary"]'],
  externalId: (url) => idFromSlug(pathSegments(url)[0]),
});

/** Indeed. www.indeed.com / in.indeed.com / www.indeed.co.in */
const indeed = defineAdapter({
  version: 'indeed@1',
  hosts: ['.indeed.com', '.indeed.co.in', 'www.indeed.com', 'in.indeed.com'],
  isJobPage: (url) =>
    url.pathname.includes('/viewjob') ||
    url.pathname.includes('/rc/clk') ||
    url.searchParams.has('jk'),
  title: [
    '[data-testid="simulated-title"]',
    '.jobsearch-JobInfoHeader-title',
    'h1.jobsearch-JobInfoHeader-title',
    'h1',
  ],
  company: [
    '[data-testid="inlineHeader-companyName"] a',
    '[data-testid="inlineHeader-companyName"]',
    '.jobsearch-InlineCompanyRating-companyHeader',
    '[class*="companyName"]',
  ],
  location: [
    '[data-testid="inlineHeader-companyLocation"]',
    '.jobsearch-JobInfoHeader-subtitle',
    '[class*="companyLocation"]',
  ],
  comp: ['#salaryInfoAndJobType', '[data-testid="jobMetaData"]', '[class*="salary"]'],
  externalId: (url) => url.searchParams.get('jk') ?? idFromSlug(url.searchParams.get('vjk')),
});

/** Foundit / Monster India. www.foundit.in */
const foundit = defineAdapter({
  version: 'foundit@1',
  hosts: ['www.foundit.in', '.foundit.in', '.foundit.com'],
  isJobPage: (url) =>
    url.pathname.includes('/seeker/job-details') ||
    url.pathname.includes('/job/') ||
    segmentAfter(url, 'job') !== null,
  title: ['h1.job-title', '[class*="jobTitle"]', '[class*="jd-header-title"]', 'h1'],
  company: ['[class*="company-name"]', '[class*="companyName"]', '.companyName'],
  location: ['[class*="location"]', '[class*="job-location"]'],
  comp: ['[class*="salary"]', '[class*="package"]'],
  externalId: (url) => idFromSlug(pathSegments(url).pop()),
});

/** Glassdoor. www.glassdoor.com / www.glassdoor.co.in */
const glassdoor = defineAdapter({
  version: 'glassdoor@1',
  hosts: ['.glassdoor.com', '.glassdoor.co.in'],
  isJobPage: (url) =>
    url.pathname.includes('/Job/') ||
    url.pathname.includes('/job-listing/') ||
    url.searchParams.has('jl'),
  title: ['[data-test="job-title"]', '.JobDetails_jobTitle__', 'h1'],
  company: ['[data-test="employer-name"]', '.EmployerProfile_employerName__', '[class*="Employer"]'],
  location: ['[data-test="location"]', '.JobDetails_location__', '[class*="Location"]'],
  externalId: (url) => url.searchParams.get('jl') ?? idFromSlug(pathSegments(url).pop()),
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
    employmentType: normalizeEmploymentType(
      textFrom(doc, ['[data-automation="job-detail-work-type"]'], { maxLength: 60 })
    ),
  }),
});

export const BOARD_ADAPTERS: JobAdapter[] = [
  naukri,
  indeed,
  foundit,
  glassdoor,
  instahyre,
  cutshort,
  hirist,
  seek,
];
