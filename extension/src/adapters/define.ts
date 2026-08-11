import type { AtsProvider, CapturedJob } from '@jobpilot/shared';
import {
  hostMatches,
  humanizeSlug,
  labelledValue,
  metaFrom,
  pathSegments,
  remoteFromLocation,
  squish,
  tenantFromHost,
  textFrom,
  type JobAdapter,
} from './types.js';

/**
 * Adapter factory.
 *
 * Most ATSs need the same four things read off the page and differ only in
 * where those four things live. Hand-writing that shape twenty times produced
 * twenty subtly different versions of the same bug — one adapter forgetting
 * the meta fallback, another forgetting to strip the company off the title.
 * A spec is declarative enough to check at a glance, which matters most for
 * the platforms nobody here can test against.
 *
 * Anything that needs real logic — Workday's requisition ids, LinkedIn's
 * render race — still gets a hand-written adapter. This is for the ones that
 * genuinely are a list of selectors.
 */

export interface AdapterSpec {
  /**
   * Defaults to GENERIC.
   *
   * `ats` is a Postgres enum, so a new value is a migration; most of these
   * platforms are not worth one. `version` carries the real platform name and
   * is stored on every captured event, so provenance survives regardless —
   * a GENERIC row tagged "workable@1" is still unambiguously Workable.
   */
  ats?: AtsProvider;
  version: string;
  /** Exact hostnames, or dotted suffixes (".workable.com"). */
  hosts: string[];
  isJobPage(url: URL): boolean;

  title?: string[];
  company?: string[];
  location?: string[];
  comp?: string[];

  /** Label text to look beside, for platforms that render metadata as pairs. */
  labels?: {
    location?: string[];
    comp?: string[];
  };

  /** Last resort for the company name, after selectors and structured data. */
  companyFallback?: (url: URL, doc: Document) => string | null;
  externalId?: (url: URL, doc: Document) => string | null;
  /** Fields outside the common four. */
  extra?: (doc: Document, url: URL) => Partial<CapturedJob>;

  confirmationSelectors?: string[];
  descriptionSelectors?: string[];
}

/**
 * Strip the boilerplate a page title carries.
 *
 * `og:title` is the most reliable title source on a hashed-class SPA and the
 * dirtiest: "Job Application for Staff Engineer at Acme | Careers" is one
 * string containing the answer. The company suffix has to go — left in, it
 * defeats duplicate matching, because `normalizeTitle` has no reason to know
 * that "Staff Engineer at Acme" and "Staff Engineer" are the same role.
 */
export function cleanJobTitle(raw: string, company: string | null): string {
  let title = squish(raw)
    .replace(/^job\s+application\s+for\s+/i, '')
    .replace(/^apply\s+(?:for|to)\s+/i, '');

  // Trailing site furniture: " | Careers", " - Jobs at Acme", " • Acme".
  const separators = /\s+[|–—•-]\s+/;
  const parts = title.split(separators);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1].toLowerCase();
    const isFurniture =
      /^(careers?|jobs?|job\s+board|hiring|apply|vacancies|work\s+with\s+us)$/.test(tail) ||
      (company !== null && tail.includes(company.toLowerCase()));
    if (isFurniture) title = parts.slice(0, -1).join(' - ');
  }

  if (company) {
    // " at Acme" / " @ Acme", only when it really is the trailing company.
    const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp(`\\s+(?:at|@)\\s+${escaped}\\s*$`, 'i'), '');
  }

  return squish(title);
}

/**
 * Reject a "title" that is really the site's name.
 *
 * `document.title` is the last fallback in the chain and the most dangerous
 * one: on a client-rendered posting it is often still "Careers | Acme" when
 * the body arrives, and a page that has already passed `isJobPage` will
 * happily record that as the role. An h1 holding a logo fails the same way.
 * Dropping to null costs a field; keeping it writes a row that says the user
 * applied for a job called "Careers".
 */
const TITLE_FURNITURE = /^(careers?|jobs?|home|apply|job\s+details?|vacancies|open\s+roles?)$/i;

export function looksLikeTitle(title: string, company: string | null): boolean {
  if (!title || TITLE_FURNITURE.test(title)) return false;
  if (company && title.toLowerCase() === company.toLowerCase()) return false;
  return true;
}

export function defineAdapter(spec: AdapterSpec): JobAdapter {
  return {
    ats: spec.ats ?? 'GENERIC',
    version: spec.version,

    matches(url) {
      return hostMatches(url, spec.hosts);
    },

    isJobPage(url) {
      return spec.isJobPage(url);
    },

    extract(doc, url) {
      /*
       * Company first: the title cleanup needs it, and it is the value most
       * often recoverable from the URL when the DOM gives nothing.
       */
      const company =
        textFrom(doc, spec.company ?? [], { maxLength: 120 }) ??
        spec.companyFallback?.(url, doc) ??
        metaFrom(doc, ['og:site_name']) ??
        tenantFromHost(url);

      const rawTitle =
        textFrom(doc, [...(spec.title ?? []), 'h1'], { maxLength: 200 }) ??
        metaFrom(doc, ['og:title', 'twitter:title']) ??
        // document.title is the floor: every page has one, and on a
        // client-rendered posting it is often filled before the body is.
        (doc.title ? doc.title : null);

      const location =
        textFrom(doc, spec.location ?? [], { maxLength: 160 }) ??
        (spec.labels?.location ? labelledValue(doc, spec.labels.location) : null);

      const comp =
        textFrom(doc, spec.comp ?? [], { maxLength: 160 }) ??
        (spec.labels?.comp ? labelledValue(doc, spec.labels.comp) : null);

      const title = rawTitle ? cleanJobTitle(rawTitle, company) : '';

      return {
        title: looksLikeTitle(title, company) ? title : null,
        company,
        location,
        remote: remoteFromLocation(location),
        compRaw: comp,
        externalId: spec.externalId?.(url, doc) ?? null,
        ...spec.extra?.(doc, url),
      } satisfies Partial<CapturedJob>;
    },

    confirmationSelectors: spec.confirmationSelectors ?? [],
    descriptionSelectors: spec.descriptionSelectors ?? [],
  };
}

/* ------------------------------ id helpers ------------------------------ */

/** The path segment after `marker`, e.g. `/jobs/{id}/…`. */
export function segmentAfter(url: URL, marker: string): string | null {
  const segments = pathSegments(url);
  const index = segments.indexOf(marker);
  return index >= 0 ? (segments[index + 1] ?? null) : null;
}

/**
 * The numeric id out of an id-and-slug segment ("1234567-senior-engineer").
 *
 * Taking the whole segment would work too, until the employer renames the
 * posting: the slug changes, the id does not, and a captured application
 * would stop matching the posting the sweep worker re-checks.
 */
export function idFromSlug(segment: string | null | undefined): string | null {
  if (!segment) return null;
  const leading = /^(\d{3,})(?:[-_]|$)/.exec(segment);
  if (leading) return leading[1];
  const trailing = /[-_](\d{4,})$/.exec(segment);
  if (trailing) return trailing[1];
  return segment || null;
}

/** Company from a path segment, for boards that put it there. */
export function companyFromSegment(index: number) {
  return (url: URL): string | null => {
    const segment = pathSegments(url)[index];
    return segment ? humanizeSlug(decodeURIComponent(segment)) : null;
  };
}
