import type { Application, ApplicationStatus, FunnelStats } from '@jobpilot/shared';

/**
 * Fixture data for `VITE_DEMO=1`.
 *
 * Exists so the UI can be reviewed and iterated on without a database or a
 * running Worker. It is wired in at the api module boundary, so the components
 * themselves have no idea demo mode exists and there is no demo-only rendering
 * path that could drift from the real one.
 */

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

function app(
  id: string,
  title: string,
  companyName: string,
  status: ApplicationStatus,
  appliedDaysAgo: number | null,
  postingStatus: Application['postingStatus'],
  extras: Partial<Application> = {}
): Application {
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id,
    userId: 'demo-user',
    companyId: `company-${slug}`,
    company: { id: `company-${slug}`, name: companyName, slug, domain: null },
    title,
    titleSlug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    location: 'Remote',
    remote: true,
    employmentType: 'FULL_TIME',
    jobUrl: `https://jobs.lever.co/${slug}/${id}`,
    jobUrlCanonical: `https://jobs.lever.co/${slug}/${id}`,
    externalId: id,
    ats: 'LEVER',
    compMinCents: null,
    compMaxCents: null,
    compCurrency: null,
    compRaw: null,
    status,
    source: 'EXTENSION_AUTO',
    archived: false,
    starred: false,
    resumeId: null,
    appliedAt: appliedDaysAgo === null ? null : daysAgo(appliedDaysAgo),
    firstResponseAt: null,
    postingStatus,
    postingCheckedAt: daysAgo(0),
    postingCheckFailures: 0,
    createdAt: daysAgo(appliedDaysAgo ?? 0),
    updatedAt: daysAgo(0),
    ...extras,
  };
}

export const DEMO_APPLICATIONS: Application[] = [
  app('a1', 'Senior Backend Engineer', 'Stripe', 'INTERVIEW', 21, 'LIVE', {
    firstResponseAt: daysAgo(14),
    location: 'San Francisco, CA',
    remote: false,
    jobUrl: 'https://www.linkedin.com/jobs/view/3901234567',
    ats: 'LINKEDIN',
  }),
  app('a2', 'Software Engineer, Platform', 'Linear', 'SCREEN', 9, 'LIVE', {
    firstResponseAt: daysAgo(4),
    jobUrl: 'https://www.naukri.com/job-listings-software-engineer-platform-linear-9912345',
  }),
  app('a3', 'Full Stack Engineer', 'Vercel', 'APPLIED', 34, 'REMOVED', {
    jobUrl: 'https://in.indeed.com/viewjob?jk=8f21c0a4b9de',
  }),
  app('a4', 'Backend Engineer (Payments)', 'Ramp', 'APPLIED', 41, 'CLOSED'),
  app('a5', 'Product Engineer', 'Retool', 'REJECTED', 52, 'REMOVED', {
    firstResponseAt: daysAgo(38),
  }),
  app('a6', 'Senior Software Engineer', 'Notion', 'APPLIED', 12, 'LIVE', {
    jobUrl: 'https://boards.greenhouse.io/notion/jobs/5512345',
    ats: 'GREENHOUSE',
  }),
  app('a7', 'Infrastructure Engineer', 'Neon', 'OFFER', 60, 'LIVE', {
    firstResponseAt: daysAgo(48),
  }),
  app('a8', 'Engineer, Developer Tools', 'Ashby', 'SAVED', null, 'LIVE'),
  app('a9', 'Backend Engineer', 'Supabase', 'APPLIED', 5, 'LIVE'),
  app('a10', 'Staff Engineer, API', 'Cloudflare', 'APPLIED', 27, 'LIVE'),
];

export const DEMO_STATS: FunnelStats = {
  total: DEMO_APPLICATIONS.length,
  byStatus: {
    SAVED: 1,
    APPLIED: 5,
    SCREEN: 1,
    INTERVIEW: 1,
    OFFER: 1,
    ACCEPTED: 0,
    REJECTED: 1,
    GHOSTED: 0,
    WITHDRAWN: 0,
  },
  responseRate: 4 / 9,
  medianDaysToResponse: 6.5,
  ghostedCount: 3,
};

export const DEMO_DEAD_POSTINGS = [
  { id: 'a3', title: 'Full Stack Engineer', postingStatus: 'REMOVED', appliedAt: daysAgo(34) },
  { id: 'a4', title: 'Backend Engineer (Payments)', postingStatus: 'CLOSED', appliedAt: daysAgo(41) },
];

/**
 * A filled-in profile for demo mode.
 *
 * `EMPTY_PROFILE` was being used, so the profile screen in demo mode showed
 * "0% autofill readiness" and "Nothing added yet" under every heading — which
 * demonstrates the empty state rather than the product, to anyone the demo is
 * ever shown to.
 *
 * Deliberately fictional and obviously so. A demo fixture is the easiest place
 * for a real address or phone number to end up somewhere public — a store
 * screenshot, a recorded walkthrough — so nothing here belongs to anyone:
 * example.com is reserved by RFC 2606, and the number is in Ofcom's reserved
 * drama range.
 */
export const DEMO_PROFILE_FIELDS = {
  firstName: 'Alex',
  lastName: 'Rivera',
  email: 'alex.rivera@example.com',
  phone: '+44 7700 900123',
  city: 'Bengaluru',
  country: 'India',
  linkedinUrl: 'https://www.linkedin.com/in/example-alex-rivera',
  githubUrl: 'https://github.com/example-alexrivera',
  currentTitle: 'Frontend Engineer',
  currentCompany: 'Nimbus Labs',
  authorizedToWork: true,
  requiresSponsorship: false,
  willingToRelocate: true,
  skills: ['JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'CSS', 'PostgreSQL', 'Git'],
  languages: ['English', 'Hindi'],
  experience: [
    {
      id: 'demo-role-1',
      company: 'Nimbus Labs',
      title: 'Frontend Engineer',
      startDate: '2023-04',
      endDate: null,
      current: true,
      location: 'Bengaluru, India',
      description:
        'Build and maintain the customer dashboard in React and TypeScript. Took the checkout flow from 4.1s to 1.3s on mobile.',
      employmentType: 'FULL_TIME' as const,
    },
    {
      id: 'demo-role-2',
      company: 'Kettle & Co',
      title: 'Junior Web Developer',
      startDate: '2021-07',
      endDate: '2023-03',
      current: false,
      location: 'Remote',
      description: 'Shipped the marketing site and an internal order tool with Next.js and Node.js.',
      employmentType: 'FULL_TIME' as const,
    },
  ],
  education: [
    {
      id: 'demo-education-1',
      school: 'Example Institute of Technology',
      level: 'BACHELORS' as const,
      degree: 'B.Tech',
      field: 'Computer Science',
      startDate: '2017-08',
      endDate: '2021-05',
      score: '8.4',
      scoreType: 'CGPA' as const,
      studyMode: 'FULL_TIME' as const,
    },
  ],
};
