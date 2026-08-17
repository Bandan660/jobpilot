import type { CapturedJob, Profile } from '@jobpilot/shared';

/**
 * Where to look for someone who could refer you.
 *
 * SEARCHES, NOT PEOPLE
 *
 * jobpilot never names a person. Naming one would mean reading LinkedIn's
 * member directory, which is scraping — the thing this whole feature is built
 * to avoid. Instead it hands over a few searches scoped to the company and
 * lets LinkedIn do the finding, which it is better at anyway: it knows who
 * actually works there now and who is already in the user's network.
 *
 * Every link opens in a new tab and nothing is sent. See `docs/REFERRALS.md`
 * for the operating rule this sits under.
 *
 * KEYWORDS, NOT FACETS
 *
 * LinkedIn's faceted filters take opaque numeric ids — `facetSchool=12345`,
 * `facetGeoRegion=…` — which have to be looked up per school and which
 * LinkedIn changes. `keywords` is a plain string, has worked for years, and
 * degrades to a broader result set rather than to an error page. Where there
 * is a choice, this file takes the durable one.
 */

export interface ReferralSearch {
  /** Shown on the button. */
  label: string;
  /** Why this search is worth opening, in a few words. */
  hint: string;
  url: string;
}

/**
 * The company's LinkedIn slug, read off the posting.
 *
 * `adapters/linkedin.ts` already leans on `a[href*="/company/"]` for the
 * company name because it is how LinkedIn's own navigation works and has
 * outlived every redesign — the slug is sitting in that same href, free.
 *
 * Null everywhere else. A Greenhouse posting has no LinkedIn slug and guessing
 * one from the company name lands on the wrong company often enough to matter.
 */
export function companySlugFrom(doc: Document): string | null {
  const scope =
    doc.querySelector('.jobs-search__job-details') ??
    doc.querySelector('.jobs-details__main-content') ??
    doc.querySelector('.job-view-layout') ??
    doc.querySelector('main') ??
    doc;

  for (const link of scope.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]')) {
    const slug = link.getAttribute('href')?.match(/\/company\/([^/?#]+)/)?.[1];
    /*
     * "setup-new-company" and friends are LinkedIn's own admin links, which
     * appear in the page chrome on some accounts and would send the user to a
     * page about creating a company rather than to this one.
     */
    if (slug && slug !== 'setup-new-company' && !slug.startsWith('unavailable')) {
      return decodeURIComponent(slug).toLowerCase();
    }
  }

  return null;
}

/** LinkedIn's people search, used wherever there is no company slug to scope to. */
function peopleSearch(terms: string[]): string {
  const keywords = terms.filter(Boolean).join(' ');
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

/** The company's own People tab, optionally filtered by a keyword. */
function companyPeople(slug: string, keywords?: string): string {
  const base = `https://www.linkedin.com/company/${encodeURIComponent(slug)}/people/`;
  return keywords ? `${base}?keywords=${encodeURIComponent(keywords)}` : base;
}

/**
 * Words worth searching for from a job title.
 *
 * "Senior Frontend Developer (React) - Remote, 3+ yrs" as a keyword matches
 * nobody. Seniority, brackets, locations and the punctuation around them all
 * come off, leaving the two or three words that name the discipline — which is
 * what appears in the job titles of the people already doing it.
 */
export function titleKeywords(title: string | null): string | null {
  if (!title) return null;

  const cleaned = title
    .replace(/\(.*?\)/g, ' ')
    .replace(/[|/,–—-]+/g, ' ')
    .replace(
      /\b(senior|sr|junior|jr|lead|principal|staff|associate|intern|trainee|i{1,3}|iv|v|remote|hybrid|onsite|on-site|contract|fulltime|full-time|parttime|part-time|\d+\+?)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  // Three words is enough to name a discipline and few enough to still match.
  const words = cleaned.split(' ').filter((w) => w.length > 1).slice(0, 3);
  return words.length ? words.join(' ') : null;
}

/**
 * The most recent school on the profile.
 *
 * Recency rather than highest qualification: the alumni network someone can
 * actually call on is the one they left most recently, and a postgraduate
 * course is both more recent and a smaller, warmer group than an undergraduate
 * one. Falls back to the first entry when nothing carries a date.
 */
export function primarySchool(profile: Profile | null): string | null {
  const entries = (profile?.education ?? []).filter((e) => e.school?.trim());
  if (entries.length === 0) return null;

  const dated = entries.filter((e) => e.endDate ?? e.startDate);
  if (dated.length === 0) return entries[0].school.trim();

  return dated
    .slice()
    .sort((a, b) => (b.endDate ?? b.startDate ?? '').localeCompare(a.endDate ?? a.startDate ?? ''))[0]
    .school.trim();
}

/**
 * The searches to offer for this posting.
 *
 * Ordered by how likely a reply is, not by how obvious the search is. The
 * alumni row is second rather than last on purpose: in India a shared college
 * outperforms a stranger with the right job title by a wide margin, and it
 * costs nothing to put it where it will be seen. People already in the
 * network come first because they are not a cold ask at all.
 */
export function referralSearches(
  job: Pick<CapturedJob, 'title' | 'company'>,
  profile: Profile | null,
  slug: string | null
): ReferralSearch[] {
  const company = job.company?.trim();
  if (!company && !slug) return [];

  const name = company ?? slug ?? '';
  const searches: ReferralSearch[] = [];

  searches.push({
    label: `People you know at ${name}`,
    hint: 'Warmest ask — no introduction needed',
    url: slug ? companyPeople(slug) : peopleSearch([name]),
  });

  const school = primarySchool(profile);
  if (school) {
    searches.push({
      label: `${school} alumni there`,
      hint: 'A shared college answers far more often than a cold ask',
      url: slug ? companyPeople(slug, school) : peopleSearch([name, school]),
    });
  }

  const discipline = titleKeywords(job.title);
  if (discipline) {
    searches.push({
      label: `People doing this job there`,
      hint: `Searches "${discipline}" — they know the team and the req`,
      url: slug ? companyPeople(slug, discipline) : peopleSearch([name, discipline]),
    });
  }

  searches.push({
    label: `Recruiters at ${name}`,
    hint: 'Last resort — they field the most of these',
    url: slug ? companyPeople(slug, 'recruiter') : peopleSearch([name, 'recruiter']),
  });

  return searches;
}
