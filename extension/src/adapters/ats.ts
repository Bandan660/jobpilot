import { companyFromSegment, defineAdapter, idFromSlug, segmentAfter } from './define.js';
import { humanizeSlug, pathSegments, type JobAdapter } from './types.js';

/**
 * The applicant-tracking systems whose capture is a list of selectors.
 *
 * Everything here hosts the application form itself, so submit detection is
 * meaningful and each one declares whatever confirmation markup it renders.
 * Platforms that needed real logic have their own file; job boards that only
 * link out to someone else's form are in boards.ts.
 *
 * HOW MUCH TO TRUST THESE
 *
 * None of these adapters has been run against a live posting. They are built
 * from each platform's published markup conventions, and every one of them
 * ends its selector chain in something structural — `h1`, `og:title` — so the
 * failure mode when a class name rots is a thinner capture, not a wrong one.
 * The one that matters is Workday, and it has its own file for that reason.
 *
 * Where a platform emits JobPosting JSON-LD — most of the modern ones do —
 * these selectors are the fallback and not the primary path: content.ts reads
 * structured data first and only fills the gaps from here.
 */

/** jobs.smartrecruiters.com/{Company}/{id}-{slug} */
const smartrecruiters = defineAdapter({
  ats: 'SMARTRECRUITERS',
  version: 'smartrecruiters@1',
  hosts: ['.smartrecruiters.com'],
  isJobPage: (url) => {
    const segments = pathSegments(url);
    return segments.length >= 2 && /^\d{5,}/.test(segments[1]);
  },
  title: ['h1[itemprop="title"]', '[data-test="job-title"]', 'spl-job-title', '.job-title'],
  company: ['[itemprop="hiringOrganization"]', '[data-test="company-name"]', '.company-name'],
  location: ['[itemprop="jobLocation"]', 'spl-job-location', '#st-locations', '.job-location'],
  comp: ['[itemprop="baseSalary"]', '[data-test="job-compensation"]'],
  companyFallback: companyFromSegment(0),
  externalId: (url) => idFromSlug(pathSegments(url)[1]),
  confirmationSelectors: ['[data-test="thank-you"]', '.thank-you', '.application-submitted'],
});

/** apply.workable.com/{company}/j/{TOKEN}/ — the token is the posting id. */
const workable = defineAdapter({
  version: 'workable@1',
  hosts: ['.workable.com'],
  isJobPage: (url) => segmentAfter(url, 'j') !== null,
  title: ['[data-ui="job-title"]', '[data-ui="overview-title"]'],
  company: ['[data-ui="company-name"]', '[data-ui="overview-company"]'],
  location: ['[data-ui="job-location"]', '[data-ui="overview-location"]', '[data-ui="location"]'],
  comp: ['[data-ui="job-salary"]', '[data-ui="overview-salary"]'],
  companyFallback: companyFromSegment(0),
  externalId: (url) => segmentAfter(url, 'j'),
  confirmationSelectors: ['[data-ui="application-success"]', '[data-ui="thank-you"]'],
});

/**
 * iCIMS. careers-{company}.icims.com/jobs/{id}/{slug}/job
 *
 * iCIMS is usually embedded in an iframe on the employer's own careers page.
 * The content script does not declare `all_frames`, so it runs only where
 * icims.com is the top-level document — following the "apply" link out of an
 * embed, which is the path that leads to the form anyway. On the employer's
 * page the embed is invisible to us, and correctly so: capturing the wrapper
 * would record the careers index rather than the posting.
 *
 * The DOM is label-driven; `.iCIMS_*` classes exist but are themed per tenant,
 * so the label text is the more durable handle for everything but the title.
 */
const icims = defineAdapter({
  ats: 'ICIMS',
  version: 'icims@1',
  hosts: ['.icims.com'],
  isJobPage: (url) =>
    /^\d+$/.test(segmentAfter(url, 'jobs') ?? '') || url.searchParams.has('jobId'),
  title: ['h1.iCIMS_Header', '.iCIMS_Header', '[itemprop="title"]', '.iCIMS_JobHeaderTitle'],
  location: ['.iCIMS_JobHeaderField [itemprop="jobLocation"]', '[itemprop="jobLocation"]'],
  labels: {
    location: ['job locations', 'job location', 'locations', 'location'],
    comp: ['compensation', 'salary', 'pay range'],
  },
  externalId: (url) => segmentAfter(url, 'jobs') ?? url.searchParams.get('jobId'),
  confirmationSelectors: ['.iCIMS_ThankYou', '#icims_content_confirmation'],
});

/**
 * Oracle Taleo. {company}.taleo.net/careersection/{section}/jobdetail.ftl?job={id}
 *
 * Taleo generates element ids at render time — `requisitionDescriptionInterface
 * .ID1539.row1` and similar — so nothing here can be an exact id match. Two
 * consequences: the selectors use substring matching on the stable prefix, and
 * the dots in those ids would need escaping in a `#id` selector anyway, which
 * is its own footgun. Metadata is read by label instead.
 */
const taleo = defineAdapter({
  version: 'taleo@1',
  hosts: ['.taleo.net'],
  isJobPage: (url) => url.pathname.includes('jobdetail') || url.searchParams.has('job'),
  title: ['[id*="reqTitleLinkAction"]', '[id*="requisitionDescriptionInterface.reqTitle"]', '.titlepage'],
  labels: {
    location: ['primary location', 'job location', 'work locations', 'location'],
    comp: ['salary', 'compensation', 'pay'],
  },
  externalId: (url) => url.searchParams.get('job'),
  confirmationSelectors: ['[id*="confirmation"]', '.confirmationtext'],
});

/**
 * SAP SuccessFactors. career{n}.successfactors.com/career?career_job_req_id=…
 *
 * Its career-site builder stamps `data-careersite-propertyid` onto whatever
 * fields the employer chose to display. That attribute is the contract between
 * the builder and the theme, which makes it the one thing a tenant's own
 * styling cannot rename.
 *
 * SuccessFactors also serves from .successfactors.eu for EU-hosted tenants.
 * That host is not in manifest.json, so it is matched here but will not run
 * until the match pattern is added.
 */
const successfactors = defineAdapter({
  version: 'successfactors@1',
  hosts: ['.successfactors.com', '.successfactors.eu'],
  isJobPage: (url) =>
    url.searchParams.has('career_job_req_id') ||
    url.searchParams.has('jobId') ||
    url.pathname.toLowerCase().includes('jobreq'),
  title: ['[data-careersite-propertyid="title"]', '.jobTitle', '#content h1'],
  company: ['[data-careersite-propertyid="companyname"]'],
  location: ['[data-careersite-propertyid="location"]', '[data-careersite-propertyid="city"]'],
  labels: { location: ['location', 'work location'] },
  companyFallback: (url) => url.searchParams.get('company'),
  externalId: (url) =>
    url.searchParams.get('career_job_req_id') ?? url.searchParams.get('jobId'),
  confirmationSelectors: ['.jobApplicationConfirmation', '[id*="confirmation"]'],
});

/** {company}.teamtailor.com/jobs/{id}-{slug} */
const teamtailor = defineAdapter({
  version: 'teamtailor@1',
  hosts: ['.teamtailor.com'],
  isJobPage: (url) => segmentAfter(url, 'jobs') !== null,
  title: ['h1', '[class*="job-title"]'],
  company: ['[class*="company-name"]', 'header a[rel="home"]'],
  location: ['[class*="location"]', '[data-controller*="location"]'],
  externalId: (url) => idFromSlug(segmentAfter(url, 'jobs')),
  confirmationSelectors: ['[class*="application-success"]', '[class*="thank"]'],
});

/** {company}.recruitee.com/o/{slug} — "o" for offer. */
const recruitee = defineAdapter({
  version: 'recruitee@1',
  hosts: ['.recruitee.com'],
  isJobPage: (url) => segmentAfter(url, 'o') !== null,
  title: ['h1', '[class*="job-title"]', '.job-title'],
  company: ['[class*="company-name"]', '.header__company'],
  location: ['[class*="location"]', '.job-location'],
  externalId: (url) => segmentAfter(url, 'o'),
  confirmationSelectors: ['[class*="thank-you"]', '.c-application__success'],
});

/** {company}.jobs.personio.de|com/job/{id} */
const personio = defineAdapter({
  version: 'personio@1',
  hosts: ['.jobs.personio.de', '.jobs.personio.com'],
  isJobPage: (url) => segmentAfter(url, 'job') !== null,
  title: ['h1', '[class*="jobTitle"]', '.job-title'],
  location: ['[class*="jobLocation"]', '[class*="location"]'],
  externalId: (url) => segmentAfter(url, 'job'),
  confirmationSelectors: ['[class*="application-success"]', '[class*="thank"]'],
});

/** {company}.bamboohr.com/careers/{id} */
const bamboohr = defineAdapter({
  version: 'bamboohr@1',
  hosts: ['.bamboohr.com'],
  isJobPage: (url) => /^\d+$/.test(segmentAfter(url, 'careers') ?? ''),
  title: ['h1', '[class*="jobTitle"]', '[data-testid*="title"]'],
  company: ['[class*="companyName"]', '[data-testid*="company"]'],
  location: ['[class*="jobLocation"]', '[class*="location"]'],
  externalId: (url) => segmentAfter(url, 'careers'),
  confirmationSelectors: ['[class*="applicationSuccess"]', '[class*="thank"]'],
});

/**
 * Jobvite. jobs.jobvite.com/{company}/job/{id}, with an optional /careers
 * prefix — hence reading the company relative to "job" rather than from a
 * fixed index.
 */
const jobvite = defineAdapter({
  version: 'jobvite@1',
  hosts: ['.jobvite.com'],
  isJobPage: (url) => segmentAfter(url, 'job') !== null,
  title: ['.jv-header', '.jv-job-detail-title', 'h1'],
  location: ['.jv-job-detail-meta', '[class*="jv-job-detail-location"]'],
  companyFallback: (url) => {
    const segments = pathSegments(url);
    const jobIndex = segments.indexOf('job');
    const slug = jobIndex > 0 ? segments[jobIndex - 1] : null;
    return slug ? humanizeSlug(decodeURIComponent(slug)) : null;
  },
  externalId: (url) => segmentAfter(url, 'job'),
  confirmationSelectors: ['.jv-confirmation', '[class*="jv-thank"]'],
});

/** {company}.zohorecruit.com/jobs/Careers/{id}/{slug} */
const zohorecruit = defineAdapter({
  version: 'zohorecruit@1',
  hosts: ['.zohorecruit.com', '.zohorecruit.in', '.zohorecruit.eu'],
  isJobPage: (url) => /^\d+$/.test(segmentAfter(url, 'Careers') ?? ''),
  title: ['h1', '.job-title', '[class*="jobTitle"]'],
  location: ['[class*="location"]'],
  labels: { location: ['city', 'location', 'work location'] },
  externalId: (url) => segmentAfter(url, 'Careers'),
  confirmationSelectors: ['[class*="thank"]', '[class*="success"]'],
});

/** {company}.darwinbox.in — careers pages sit under /ms/candidate/careers/. */
const darwinbox = defineAdapter({
  version: 'darwinbox@1',
  hosts: ['.darwinbox.in', '.darwinbox.com'],
  isJobPage: (url) => {
    const segments = pathSegments(url);
    const careers = segments.indexOf('careers');
    return careers >= 0 && segments.length > careers + 1;
  },
  title: ['h1', '.job-title', '[class*="jobTitle"]', '[class*="job_title"]'],
  location: ['[class*="location"]'],
  labels: { location: ['location', 'job location'] },
  externalId: (url) => pathSegments(url).pop() ?? null,
  confirmationSelectors: ['[class*="thank"]', '[class*="success"]'],
});

/** {company}.keka.com/careers/jobdetails/{uuid} */
const keka = defineAdapter({
  version: 'keka@1',
  hosts: ['.keka.com'],
  isJobPage: (url) => segmentAfter(url, 'jobdetails') !== null,
  title: ['h1', '.job-title', '[class*="jobTitle"]'],
  location: ['[class*="location"]'],
  labels: { location: ['location', 'job location'], comp: ['salary', 'ctc'] },
  externalId: (url) => segmentAfter(url, 'jobdetails'),
  confirmationSelectors: ['[class*="thank"]', '[class*="success"]'],
});

export const ATS_ADAPTERS: JobAdapter[] = [
  smartrecruiters,
  workable,
  icims,
  taleo,
  successfactors,
  teamtailor,
  recruitee,
  personio,
  bamboohr,
  jobvite,
  zohorecruit,
  darwinbox,
  keka,
];
