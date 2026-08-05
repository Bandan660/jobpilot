/**
 * Normalization used for duplicate detection.
 *
 * These functions run in BOTH the extension and the API. The extension calls
 * them to ask "have I seen this?" before a submit; the API calls them to build
 * the stored keys. If the two ever disagree, duplicate detection silently
 * breaks — so they live here and nowhere else.
 */

/**
 * Query params that identify the *referrer*, not the job. Stripped so the same
 * posting reached from LinkedIn and from the company site collapses to one key.
 *
 * Deliberately a denylist, not an allowlist: some ATSs put the job id in the
 * query string (Greenhouse embed uses ?token=, Workday uses ?jobId=), and an
 * allowlist would throw those away and break dedupe entirely.
 */
const TRACKING_PARAMS = new Set([
  'gh_src',
  'lever-source',
  'lever-origin',
  'source',
  'src',
  'ref',
  'referrer',
  'referer',
  'trk',
  'trackingid',
  'refid',
  'originalsubdomain',
  'ebp',
  'position',
  'pagenum',
  'origin',
  'campaign',
  'medium',
  'mc_cid',
  'mc_eid',
  'fbclid',
  'gclid',
  'msclkid',
  'igshid',
  '_hsenc',
  '_hsmi',
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || TRACKING_PARAMS.has(k);
}

/**
 * Reduce a job URL to a stable identity key.
 *
 * Lowercases the host, drops `www.`, strips tracking params, sorts what's
 * left, and removes the fragment and trailing slash. Returns null for input
 * that isn't a parseable http(s) URL.
 */
export function canonicalizeJobUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const path = url.pathname.replace(/\/+$/, '');
  const query = params.length
    ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&')
    : '';

  // Protocol is normalized to https: the same posting served over both is one job.
  return `https://${host}${path}${query}`;
}

/** Legal-entity suffixes that carry no identity. */
const COMPANY_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'l.l.c',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'bv',
  'nv',
  'plc',
  'sa',
  'ag',
  'ab',
  'oy',
  'as',
  'pty',
  'pvt',
  'private',
  'holdings',
  'group',
  'technologies',
  'labs',
]);

const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

function stripDiacritics(input: string): string {
  // Built from a string rather than a regex literal: the combining-mark range
  // is invisible in most editors and gets mangled by copy/paste.
  return input.normalize('NFD').replace(COMBINING_MARKS, '');
}

/**
 * Company display name -> match key. "Stripe, Inc." and "stripe" both give "stripe".
 *
 * Note this drops trailing words like "Labs" and "Group", so "Acme Labs" and
 * "Acme" collapse together. That's intentional for a *warning*, but it means
 * this key must never be used to silently merge records.
 */
export function normalizeCompany(raw: string | null | undefined): string {
  if (!raw) return '';

  let s = stripDiacritics(raw.toLowerCase());
  s = s.replace(/[&]/g, ' and ');
  s = s.replace(/[^a-z0-9\s-]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Peel recognized suffixes off the end, repeatedly ("Acme Systems Inc Ltd").
  let words = s.split(' ').filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }

  return words.join('-');
}

/** Seniority shorthand, expanded so "Sr." and "Senior" match. */
const TITLE_SYNONYMS: Record<string, string> = {
  sr: 'senior',
  snr: 'senior',
  jr: 'junior',
  jnr: 'junior',
  mgr: 'manager',
  eng: 'engineer',
  engr: 'engineer',
  dev: 'developer',
  swe: 'software-engineer',
  sde: 'software-engineer',
  ii: '2',
  iii: '3',
  iv: '4',
};

/**
 * Job title -> match key.
 *
 * Strips parentheticals ("(Remote)", "(New York)"), requisition ids, and
 * punctuation, then expands seniority shorthand. Like normalizeCompany this is
 * deliberately lenient: it powers a "you may have applied to this already"
 * prompt, where a false positive costs the user one glance and a false
 * negative costs them a duplicate application.
 */
export function normalizeTitle(raw: string | null | undefined): string {
  if (!raw) return '';

  let s = stripDiacritics(raw.toLowerCase());

  // "(Remote)", "[Contract]", "{US}" - almost always location or employment type.
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, ' ');

  // Requisition ids: "#4821", "req-4821", "r12345", "job id 4821".
  s = s.replace(/\b(?:job\s*id|req(?:uisition)?(?:\s*id)?|id)\s*[:#-]?\s*[a-z]?\d[\w-]*/g, ' ');
  s = s.replace(/#\s*[\w-]*\d[\w-]*/g, ' ');
  s = s.replace(/\br\d{3,}\b/g, ' ');

  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  const words = s
    .split(' ')
    .filter(Boolean)
    .map((w) => TITLE_SYNONYMS[w] ?? w);

  return words.join('-');
}

/* -------------------------------------------------------------------------- */
/* Compensation                                                               */
/* -------------------------------------------------------------------------- */

export interface ParsedCompensation {
  minCents: number | null;
  maxCents: number | null;
  currency: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '₹': 'INR',
  '¥': 'JPY',
  '₩': 'KRW',
  'C$': 'CAD',
  A$: 'AUD',
};

/**
 * Pull a salary range out of scraped text.
 *
 * Handles "$120,000 - $160,000 a year", "$120k–$160k", "₹15,00,000",
 * "USD 90000 to 110000". Returns nulls when nothing parses — callers keep the
 * raw string either way, so a miss is recoverable but never wrong.
 */
export function parseCompensation(raw: string | null | undefined): ParsedCompensation {
  const empty: ParsedCompensation = { minCents: null, maxCents: null, currency: null };
  if (!raw) return empty;

  const text = raw.trim();
  if (!text) return empty;

  let currency: string | null = null;

  const isoMatch = text.match(/\b(USD|EUR|GBP|INR|CAD|AUD|JPY|SGD|CHF|SEK|NOK|DKK|PLN|BRL|MXN)\b/i);
  if (isoMatch) {
    currency = isoMatch[1].toUpperCase();
  } else {
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
      if (text.includes(symbol)) {
        currency = code;
        break;
      }
    }
  }

  // Numbers with optional thousands separators (any grouping, so Indian
  // 15,00,000 works too) and an optional k/m suffix.
  const numberPattern = /(\d[\d,\s]*(?:\.\d+)?)\s*([km])?\b/gi;
  const values: number[] = [];

  for (const match of text.matchAll(numberPattern)) {
    const digits = match[1].replace(/[,\s]/g, '');
    if (!digits) continue;

    let value = Number.parseFloat(digits);
    if (!Number.isFinite(value)) continue;

    const suffix = match[2]?.toLowerCase();
    if (suffix === 'k') value *= 1_000;
    else if (suffix === 'm') value *= 1_000_000;

    // Filter out things that clearly aren't money: years, "401k" already became
    // 401000 so we bound the low end too.
    if (value < 1_000 || value > 100_000_000) continue;
    if (value >= 1900 && value <= 2100 && !suffix) continue;

    values.push(Math.round(value));
  }

  if (values.length === 0) return { ...empty, currency };

  const min = Math.min(...values);
  const max = Math.max(...values);

  return {
    minCents: min * 100,
    maxCents: max === min ? null : max * 100,
    currency,
  };
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

export function daysBetween(from: Date | string, to: Date | string = new Date()): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86_400_000);
}
