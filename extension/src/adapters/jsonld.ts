import { normalizeEmploymentType, type CapturedJob } from '@jobpilot/shared';

/**
 * schema.org JobPosting extractor.
 *
 * Tried before any CSS selector. Most ATSs emit JobPosting JSON-LD for Google
 * Jobs indexing, and that markup is contractual -- it survives the visual
 * redesigns that silently break selector-based scraping. Selectors are the
 * fallback, not the primary path.
 */

type Json = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function typeOf(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return [];
  const raw = (node as Json)['@type'];
  return asArray(raw).filter((t): t is string => typeof t === 'string');
}

/** Walks @graph and nested arrays looking for the first JobPosting node. */
function findJobPosting(node: unknown, depth = 0): Json | null {
  if (depth > 6 || typeof node !== 'object' || node === null) return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeOf(node).includes('JobPosting')) return node as Json;

  const graph = (node as Json)['@graph'];
  if (graph) return findJobPosting(graph, depth + 1);

  return null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

function extractLocation(posting: Json): string | null {
  const locations = asArray(posting.jobLocation);
  const parts: string[] = [];

  for (const loc of locations) {
    if (typeof loc !== 'object' || loc === null) continue;
    const address = (loc as Json).address;
    if (typeof address !== 'object' || address === null) continue;

    const a = address as Json;
    const city = text(a.addressLocality);
    const region = text(a.addressRegion);
    const country = text(a.addressCountry) ?? text((a.addressCountry as Json)?.name);

    const joined = [city, region, country].filter(Boolean).join(', ');
    if (joined) parts.push(joined);
  }

  return parts.length > 0 ? parts.join(' | ') : null;
}

function extractSalary(posting: Json): string | null {
  const salary = posting.baseSalary;
  if (typeof salary !== 'object' || salary === null) return null;

  const s = salary as Json;
  const currency = text(s.currency) ?? '';
  const value = s.value;

  if (typeof value === 'object' && value !== null) {
    const v = value as Json;
    const min = text(v.minValue);
    const max = text(v.maxValue);
    const single = text(v.value);
    const unit = text(v.unitText) ?? '';

    if (min && max) return `${currency} ${min} - ${max} ${unit}`.trim();
    if (single) return `${currency} ${single} ${unit}`.trim();
  }

  const flat = text(value);
  return flat ? `${currency} ${flat}`.trim() : null;
}

function extractRemote(posting: Json): boolean | null {
  const locationType = text(posting.jobLocationType);
  if (locationType && locationType.toUpperCase().includes('TELECOMMUTE')) return true;
  return null;
}

function extractIdentifier(posting: Json): string | null {
  const id = posting.identifier;
  if (typeof id === 'string') return id;
  if (typeof id === 'object' && id !== null) return text((id as Json).value);
  return null;
}

/** The first JobPosting node in any ld+json block on the page. */
function postingNode(doc: Document): Json | null {
  const scripts = doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]');

  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      // Malformed JSON-LD is common; skip and try the next block.
      continue;
    }

    const posting = findJobPosting(parsed);
    if (posting) return posting;
  }

  return null;
}

/**
 * Does this page declare itself a job posting?
 *
 * The generic adapter's whole gate. Structured data is a claim the page makes
 * in public, for Google Jobs, and it is the only evidence available on a host
 * nothing here knows anything about.
 */
export function hasJobPosting(doc: Document): boolean {
  return postingNode(doc) !== null;
}

/**
 * The posting's description text, from structured data.
 *
 * `JobPosting.description` is HTML in practice — the spec allows it and every
 * ATS takes the option, so this arrives as a blob of `<p>` and `<li>` tags.
 * Parsed with the DOM rather than a tag-stripping regex: the text inside is
 * user-supplied and a regex that gets it wrong yields either markup in the
 * prompt or a truncated description, and the DOM is right for free.
 *
 * List items get a leading dash. Requirements are almost always a bulleted
 * list, and flattening them into one paragraph loses the boundary between
 * "5 years of React" and the next line.
 */
export function descriptionFromJsonLd(doc: Document): string | null {
  const posting = postingNode(doc);
  const raw = posting ? text(posting.description) : null;
  if (!raw) return null;

  /*
   * Parsed into an inert document, not into this one.
   *
   * `raw` is HTML the page supplied, and `div.innerHTML = raw` on a live
   * document starts fetching whatever it names — `<img src=...>` fires even
   * on a detached node — so a posting could make the extension emit requests
   * of its choosing simply by being read. `DOMParser` builds a document with
   * no browsing context: no loads, no timers, no handlers, just the tree,
   * which is all this function ever wanted.
   */
  const holder = new DOMParser().parseFromString(raw, 'text/html').body;

  for (const item of holder.querySelectorAll('li')) {
    item.textContent = `- ${item.textContent?.trim() ?? ''}`;
  }
  for (const block of holder.querySelectorAll('p, div, br, li, h1, h2, h3, h4')) {
    block.after(doc.createTextNode('\n'));
  }

  const flattened = (holder.textContent ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return flattened || null;
}

export function extractFromJsonLd(doc: Document): Partial<CapturedJob> | null {
  const posting = postingNode(doc);
  if (!posting) return null;

  const org = posting.hiringOrganization;
  const company = typeof org === 'object' && org !== null ? text((org as Json).name) : text(org);

  return {
    title: text(posting.title),
    company,
    location: extractLocation(posting),
    remote: extractRemote(posting),
    employmentType: normalizeEmploymentType(
      Array.isArray(posting.employmentType)
        ? String(posting.employmentType[0])
        : (posting.employmentType as string | undefined)
    ),
    externalId: extractIdentifier(posting),
    compRaw: extractSalary(posting),
    postedDate: text(posting.datePosted),
  };
}
