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
  }),
  app('a2', 'Software Engineer, Platform', 'Linear', 'SCREEN', 9, 'LIVE', {
    firstResponseAt: daysAgo(4),
  }),
  app('a3', 'Full Stack Engineer', 'Vercel', 'APPLIED', 34, 'REMOVED'),
  app('a4', 'Backend Engineer (Payments)', 'Ramp', 'APPLIED', 41, 'CLOSED'),
  app('a5', 'Product Engineer', 'Retool', 'REJECTED', 52, 'REMOVED', {
    firstResponseAt: daysAgo(38),
  }),
  app('a6', 'Senior Software Engineer', 'Notion', 'APPLIED', 12, 'LIVE'),
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
