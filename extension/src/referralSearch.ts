import type { CapturedJob } from '@jobpilot/shared';

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
 * LinkedIn's faceted filters take opaque numeric ids — `facetGeoRegion=…`,
 * `facetSchool=…` — which have to be looked up and which LinkedIn changes.
 * `keywords` is a plain string, has worked for years, supports LinkedIn's own
 * boolean operators, and degrades to a broader result set rather than to an
 * error page. Where there is a choice, this file takes the durable one.
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

/**
 * Who to ask when there is nobody warmer.
 *
 * Both titles, because which one exists is a property of the company: a large
 * employer has recruiters, a small one has an HR generalist doing the same
 * work. Searching only one of them returns an empty page at half of all
 * companies, and an empty page reads as "nobody here can help".
 */
const HIRING_KEYWORDS = 'recruiter OR HR';

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
 * The searches to offer for this posting.
 *
 * Three, ordered by how likely a reply is rather than by how obvious the
 * search is. People already in the network come first because they are not a
 * cold ask at all; the people doing the job know the team and the req; hiring
 * staff field the most of these and answer the fewest.
 *
 * A short list on purpose. Four rows of links in a panel that also carries a
 * match score and an apply button is a menu, and a menu gets scrolled past —
 * whereas three obvious choices get pressed.
 */
export function referralSearches(
  job: Pick<CapturedJob, 'title' | 'company'>,
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

  const discipline = titleKeywords(job.title);
  if (discipline) {
    searches.push({
      label: `People doing this job there`,
      hint: `Searches "${discipline}" — they know the team and the req`,
      url: slug ? companyPeople(slug, discipline) : peopleSearch([name, discipline]),
    });
  }

  /*
   * One row, both words.
   *
   * Whether hiring sits with a "recruiter" or with "HR" is a fact about the
   * company's size, not about who the user should approach: large employers
   * staff a recruiting function, and smaller ones give the whole job to HR
   * under that title. Splitting them into two rows would make the user pick
   * between them without telling them which applies — and on any given company
   * one of the two returns nothing.
   *
   * `OR` is LinkedIn's own boolean keyword operator and must be uppercase;
   * lowercase "or" is matched as a word. It degrades safely: an engine that
   * ignores the operator sees ordinary keywords and returns a wider set, which
   * is still hiring staff at the right company.
   *
   * The company People tab needs no company term — the page is already scoped
   * to it. The fallback search does, and there the operator has to be bracketed
   * or precedence eats it: `Acme Labs recruiter OR HR` reads as
   * "(Acme Labs recruiter) OR (HR)" and returns every HR person on LinkedIn.
   * The company name is quoted for the same class of reason — two bare words
   * would match either.
   */
  searches.push({
    label: `Recruiters & HR at ${name}`,
    hint: 'They field the most of these — and answer the fewest',
    url: slug
      ? companyPeople(slug, HIRING_KEYWORDS)
      : peopleSearch([`"${name}"`, `(${HIRING_KEYWORDS})`]),
  });

  return searches;
}
