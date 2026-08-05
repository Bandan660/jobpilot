import type { CapturedJob } from '@jobpilot/shared';

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

export function extractFromJsonLd(doc: Document): Partial<CapturedJob> | null {
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
    if (!posting) continue;

    const org = posting.hiringOrganization;
    const company =
      typeof org === 'object' && org !== null ? text((org as Json).name) : text(org);

    return {
      title: text(posting.title),
      company,
      location: extractLocation(posting),
      remote: extractRemote(posting),
      externalId: extractIdentifier(posting),
      compRaw: extractSalary(posting),
    };
  }

  return null;
}
