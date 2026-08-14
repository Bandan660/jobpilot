import type { AtsProvider } from '@jobpilot/shared';

/**
 * Where an application was made, for the tracker's row.
 *
 * READ OFF THE URL, NOT THE `ats` COLUMN
 *
 * `ats` answers a different question — which system owned the *form* — and its
 * enum has no NAUKRI or INDEED at all, because neither is an ATS. Naukri is one
 * of the three platforms the first release ships enabled, so an answer derived
 * from `ats` would be blank for a third of everything anyone has applied to.
 * The URL is what the user recognises anyway: they remember applying "on
 * LinkedIn", not "through a Greenhouse form embedded somewhere".
 *
 * `ats` is still the fallback, for the rows that have no URL — a CSV import or
 * something typed in by hand.
 */
export type JobSourceKey =
  | 'linkedin'
  | 'indeed'
  | 'naukri'
  | 'glassdoor'
  | 'monster'
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'ashby'
  | 'other';

export interface JobSource {
  key: JobSourceKey;
  /** What the row says. The platform's own name, spelled its way. */
  label: string;
}

/**
 * Host fragment → platform. Fragments rather than exact hosts because every
 * one of these runs several: `in.indeed.com`, `uk.linkedin.com`,
 * `www.naukri.com`, and Greenhouse and Lever both serve each employer from
 * their own subdomain.
 */
const BY_HOST: { match: string; key: JobSourceKey; label: string }[] = [
  { match: 'linkedin.', key: 'linkedin', label: 'LinkedIn' },
  { match: 'indeed.', key: 'indeed', label: 'Indeed' },
  { match: 'naukri.', key: 'naukri', label: 'Naukri' },
  { match: 'glassdoor.', key: 'glassdoor', label: 'Glassdoor' },
  { match: 'monster.', key: 'monster', label: 'Monster' },
  { match: 'greenhouse.io', key: 'greenhouse', label: 'Greenhouse' },
  { match: 'lever.co', key: 'lever', label: 'Lever' },
  { match: 'myworkday', key: 'workday', label: 'Workday' },
  { match: 'workday.com', key: 'workday', label: 'Workday' },
  { match: 'ashbyhq.com', key: 'ashby', label: 'Ashby' },
];

const BY_ATS: Partial<Record<AtsProvider, JobSource>> = {
  LINKEDIN: { key: 'linkedin', label: 'LinkedIn' },
  GREENHOUSE: { key: 'greenhouse', label: 'Greenhouse' },
  LEVER: { key: 'lever', label: 'Lever' },
  WORKDAY: { key: 'workday', label: 'Workday' },
  ASHBY: { key: 'ashby', label: 'Ashby' },
};

/**
 * An unrecognised host is still worth showing, as itself.
 *
 * "careers.acme.com" tells the user where they applied far better than a
 * generic "Other" does, and the tracker's whole job is remembering things they
 * would otherwise have to. `www.` goes because it is noise in a 13px chip.
 */
function hostLabel(hostname: string): string {
  return hostname.replace(/^www\./, '');
}

export function jobSource(jobUrl: string | null, ats: AtsProvider | null): JobSource | null {
  if (jobUrl) {
    let hostname: string;
    try {
      hostname = new URL(jobUrl).hostname.toLowerCase();
    } catch {
      // A stored URL that will not parse is not worth a broken row.
      hostname = '';
    }

    if (hostname) {
      const known = BY_HOST.find((entry) => hostname.includes(entry.match));
      if (known) return { key: known.key, label: known.label };
      return { key: 'other', label: hostLabel(hostname) };
    }
  }

  // GENERIC is deliberately not mapped: it means "we could not tell", and
  // "Generic" on a row would read as the name of a place.
  return (ats && BY_ATS[ats]) ?? null;
}
