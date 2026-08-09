import type { AtsProvider, CapturedJob } from '@jobpilot/shared';

export interface JobAdapter {
  ats: AtsProvider;
  /**
   * Bumped whenever selectors change. Stored on every captured event so a bad
   * scrape can be traced to the adapter version that produced it.
   */
  version: string;
  matches(url: URL): boolean;
  /** True only on an individual posting page, not a board listing. */
  isJobPage(url: URL): boolean;
  /** CSS-selector extraction. Only fills what JSON-LD did not provide. */
  extract(doc: Document, url: URL): Partial<CapturedJob>;
  /**
   * Which posting the URL is asking for, and which one the DOM is actually
   * showing. Both, because they disagree during a single-page navigation.
   *
   * Clicking a different result on LinkedIn changes the URL immediately and
   * re-renders the detail pane a moment later. A scrape taken in between reads
   * the *previous* posting and looks perfectly valid — so extraction is
   * retried until these two agree.
   *
   * renderedExternalId MUST read from the document. Deriving it from the URL
   * makes the comparison trivially true and the guard useless.
   */
  expectedExternalId?(url: URL): string | null;
  renderedExternalId?(doc: Document): string | null;

  /**
   * Where the posting's body text lives, most specific first.
   *
   * Optional: without it the description falls back to structured data and
   * then to a heuristic, which is usually enough. Worth filling in for
   * platforms whose JSON-LD carries a summary rather than the whole posting.
   */
  descriptionSelectors?: string[];

  /** Elements whose presence means the application went through. */
  confirmationSelectors: string[];
  /**
   * Where to look for confirmation, when the whole page is too wide a net.
   *
   * The default is the document. LinkedIn needs narrowing: its job list
   * renders "Application submitted" against every posting you have already
   * applied to, so a page-wide text match would record an application for
   * whichever job you happen to be *viewing*. Returning null means "not
   * confirmable right now" rather than "search everything".
   */
  confirmationScope?(): Element | null;
}

/**
 * Collapse the whitespace a rendered DOM carries into a single-line value.
 *
 * `textContent` preserves the source formatting, so a Workday location that
 * reads "Bengaluru, India" on screen arrives as a newline, fourteen spaces,
 * the city, another newline. Trimming the ends is not enough — the run in the
 * middle survives, and lands in the database.
 */
export function squish(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export interface TextOptions {
  /**
   * Reject anything longer than this.
   *
   * The loose selectors these adapters end on — `[class*="location"]` and
   * friends — match a wrapper as happily as a label, and a wrapper's
   * textContent is the whole posting. A title or a location has a length; a
   * value well past it is a mis-match, and returning null lets the next
   * selector in the chain try instead.
   */
  maxLength?: number;
}

/** First selector that yields plausible non-empty text wins. */
export function textFrom(
  doc: Document | Element,
  selectors: string[],
  options: TextOptions = {}
): string | null {
  const limit = options.maxLength ?? 300;

  for (const selector of selectors) {
    let elements: NodeListOf<Element>;
    try {
      elements = doc.querySelectorAll(selector);
    } catch {
      // A malformed selector must not take the whole capture down with it.
      continue;
    }

    for (const el of elements) {
      const value = squish(el.textContent ?? '');
      if (value && value.length <= limit) return value;
    }
  }
  return null;
}

/** First selector that yields a non-empty attribute wins. */
export function attrFrom(
  doc: Document | Element,
  selectors: string[],
  attribute: string
): string | null {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute(attribute);
    const cleaned = value ? squish(value) : '';
    if (cleaned) return cleaned;
  }
  return null;
}

/** `<meta property="og:title">` and friends, by property or name. */
export function metaFrom(doc: Document, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/"/g, '\\"');
    const value = attrFrom(
      doc,
      [`meta[property="${escaped}"]`, `meta[name="${escaped}"]`],
      'content'
    );
    if (value) return value;
  }
  return null;
}

/**
 * Value sitting next to a label — "Job Locations: Bengaluru".
 *
 * The older ATSs (iCIMS, Taleo, SuccessFactors) render posting metadata as
 * label/value pairs with no class worth targeting, so the label text is the
 * only durable handle. Matches `<dt>/<dd>`, table rows, and the
 * label-span-next-to-value-span shape all three of them also use.
 */
export function labelledValue(doc: Document | Element, labels: string[]): string | null {
  const wanted = labels.map((label) => label.toLowerCase());
  const candidates = doc.querySelectorAll('dt, th, label, .label, [class*="label" i]');

  for (const node of candidates) {
    const text = squish(node.textContent ?? '')
      .toLowerCase()
      .replace(/[:*]\s*$/, '');
    if (!wanted.some((label) => text === label || text.startsWith(label))) continue;

    // <dt>/<dd> and <th>/<td> put the value in the next sibling; the
    // label-span shape puts it in a sibling too, just an untagged one.
    const value = squish(node.nextElementSibling?.textContent ?? '');
    if (value && value.length <= 200) return value;
  }

  return null;
}

/**
 * Remote, read off the location string.
 *
 * Only ever returns true or null, never false. Most postings simply do not
 * say, and a location of "London" is not evidence that the role is on-site —
 * recording false there would be inventing a fact the page never stated.
 */
export function remoteFromLocation(location: string | null): boolean | null {
  if (!location) return null;
  return /\b(remote|work from home|wfh|telecommute|anywhere)\b/i.test(location) ? true : null;
}

export function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean);
}

/**
 * Host match by exact name or by dotted suffix.
 *
 * Suffixes are written with a leading dot (".workable.com") so that a
 * lookalike domain registered as "notworkable.com" cannot match — the naive
 * `endsWith('workable.com')` does match it.
 */
export function hostMatches(url: URL, patterns: string[]): boolean {
  const host = url.hostname.toLowerCase();
  return patterns.some((pattern) =>
    pattern.startsWith('.') ? host.endsWith(pattern) : host === pattern
  );
}

/**
 * The tenant label of a multi-tenant ATS host.
 *
 * "acme.wd3.myworkdayjobs.com" and "careers-acme.icims.com" both identify the
 * employer in the subdomain, and on those platforms it is often the only place
 * the company name appears at all. Generic prefixes and suffixes vendors add
 * around it are stripped; anything left that is plainly not a name — "www",
 * "jobs" — returns null rather than a wrong company.
 */
const HOST_LABEL_NOISE = /^(www|jobs?|careers?|apply|apply-|recruiting|hire|hiring|talent)$/i;

export function tenantFromHost(url: URL): string | null {
  const label = url.hostname.toLowerCase().split('.')[0] ?? '';
  const stripped = label.replace(/^(careers?|jobs?|apply|recruiting)[-_]/, '');
  if (!stripped || HOST_LABEL_NOISE.test(stripped)) return null;
  return humanizeSlug(stripped);
}

/**
 * Turn a URL slug into something presentable ("acme-corp" -> "Acme Corp").
 * Only a fallback: JSON-LD's hiringOrganization.name is always preferred.
 */
export function humanizeSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
