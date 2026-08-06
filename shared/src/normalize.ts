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

/** How often the figure is paid. Without this, 45/hour and 45,000/year are indistinguishable. */
export const PAY_PERIODS = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export type PayPeriod = (typeof PAY_PERIODS)[number];

export interface ParsedCompensation {
  minCents: number | null;
  maxCents: number | null;
  currency: string | null;
  period: PayPeriod | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  'C$': 'CAD',
  A$: 'AUD',
  R$: 'BRL',
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '₹': 'INR',
  '¥': 'JPY',
  '₩': 'KRW',
  '₪': 'ILS',
  '₺': 'TRY',
  '₦': 'NGN',
  R: 'ZAR',
};

const PERIOD_PATTERNS: [RegExp, PayPeriod][] = [
  [/\b(per\s*hour|hourly|\/\s*h(ou)?r|\bp\/h\b|\bph\b)/i, 'HOUR'],
  [/\b(per\s*day|daily|\/\s*day|per\s*diem)/i, 'DAY'],
  [/\b(per\s*week|weekly|\/\s*w(ee)?k)/i, 'WEEK'],
  [/\b(per\s*month|monthly|\/\s*mo(nth)?\b|\bpm\b)/i, 'MONTH'],
  [/\b(per\s*(year|annum)|annually|yearly|p\.?a\.?\b|\/\s*(yr|year)|lpa\b|a\s*year)/i, 'YEAR'],
];

/**
 * Scale words. Lakh and crore matter because Indian listings quote "18 LPA" or
 * "₹15,00,000" — and the second one only parses correctly if thousands
 * separators are stripped without assuming groups of three.
 */
const SCALES: [RegExp, number][] = [
  [/^(cr|crore|crores)$/i, 1e7],
  [/^(l|lac|lacs|lakh|lakhs|lpa)$/i, 1e5],
  [/^(m|mn|million)$/i, 1e6],
  [/^k$/i, 1e3],
];

/** Plausible lower bound for a figure at each cadence, to reject stray numbers. */
const MIN_PLAUSIBLE: Record<PayPeriod, number> = {
  HOUR: 3,
  DAY: 20,
  WEEK: 100,
  MONTH: 300,
  YEAR: 1000,
};

/**
 * Pull a salary range out of scraped text.
 *
 * Handles "$120,000 - $160,000 a year", "$120k–$160k", "₹15,00,000",
 * "USD 90000 to 110000". Returns nulls when nothing parses — callers keep the
 * raw string either way, so a miss is recoverable but never wrong.
 */
export function parseCompensation(raw: string | null | undefined): ParsedCompensation {
  const empty: ParsedCompensation = {
    minCents: null,
    maxCents: null,
    currency: null,
    period: null,
  };
  if (!raw) return empty;

  const text = raw.trim();
  if (!text) return empty;

  /* Currency ------------------------------------------------------------- */

  let currency: string | null = null;

  const isoMatch = text.match(
    /\b(USD|EUR|GBP|INR|CAD|AUD|NZD|JPY|SGD|HKD|CHF|SEK|NOK|DKK|PLN|CZK|BRL|MXN|ZAR|AED|ILS|TRY|NGN|KRW|CNY|RUB)\b/i
  );
  if (isoMatch) {
    currency = isoMatch[1].toUpperCase();
  } else {
    // Longest symbols first: "C$" and "R$" must beat the bare "$" and "R".
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
      if (text.includes(symbol)) {
        currency = code;
        break;
      }
    }
  }

  /* Period --------------------------------------------------------------- */

  let period: PayPeriod | null = null;
  for (const [pattern, value] of PERIOD_PATTERNS) {
    if (pattern.test(text)) {
      period = value;
      break;
    }
  }

  // Lakh/crore notation is effectively an Indian-market signal, and LPA states
  // the cadence outright.
  if (/\b(lpa|lakh|lakhs|lac|lacs|crore|crores|cr)\b/i.test(text)) {
    currency ??= 'INR';
    period ??= 'YEAR';
  }

  /* Amounts -------------------------------------------------------------- */

  // Digits with any thousands grouping (so Indian 15,00,000 parses) followed by
  // an optional scale word.
  const numberPattern = /(\d[\d,\s]*(?:\.\d+)?)\s*([a-z]{1,6})?/gi;
  const floor = MIN_PLAUSIBLE[period ?? 'YEAR'];

  const candidates: { value: number; scale: number | null }[] = [];

  for (const match of text.matchAll(numberPattern)) {
    const digits = match[1].replace(/[,\s]/g, '');
    if (!digits) continue;

    const value = Number.parseFloat(digits);
    if (!Number.isFinite(value)) continue;

    const word = match[2] ?? '';
    let scale: number | null = null;
    for (const [pattern, factor] of SCALES) {
      if (pattern.test(word)) {
        scale = factor;
        break;
      }
    }

    candidates.push({ value, scale });
  }

  /*
   * In a range, the scale word usually sits only on the last number:
   * "18 - 24 LPA" means both are lakhs, and "$120 - 160k" means both are
   * thousands. Taken literally the first figure is a bare 18, which then falls
   * below the plausibility floor and disappears — turning a range into a
   * single number.
   *
   * So a scale found anywhere is applied to unscaled figures that would
   * otherwise be implausible. Figures that already stand on their own —
   * "$120,000 - $160,000" — are left alone, because the scale is not theirs.
   */
  const trailingScale = candidates.reduce<number | null>(
    (found, candidate) => candidate.scale ?? found,
    null
  );

  const values: number[] = [];

  for (const { value, scale } of candidates) {
    let amount = value * (scale ?? 1);

    if (scale === null && trailingScale !== null && amount < floor) {
      amount = value * trailingScale;
    }

    const wasScaled = amount !== value;

    // A bare four-digit number in the 1900–2100 range is a year, not money.
    if (!wasScaled && value >= 1900 && value <= 2100 && Number.isInteger(value)) continue;
    if (amount < floor || amount > 1e11) continue;

    values.push(Math.round(amount));
  }

  if (values.length === 0) return { ...empty, currency, period };

  const min = Math.min(...values);
  const max = Math.max(...values);

  return {
    minCents: min * 100,
    maxCents: max === min ? null : max * 100,
    currency,
    period,
  };
}

/**
 * Normalise to an annual figure so packages quoted at different cadences can be
 * compared. Approximate by design — 2080 working hours, 260 days, 52 weeks —
 * and only ever used for display and aggregate stats, never to restate an
 * employer's number back to them.
 */
export function toAnnualCents(cents: number, period: PayPeriod | null): number {
  switch (period) {
    case 'HOUR':
      return Math.round(cents * 2080);
    case 'DAY':
      return Math.round(cents * 260);
    case 'WEEK':
      return Math.round(cents * 52);
    case 'MONTH':
      return Math.round(cents * 12);
    default:
      return cents;
  }
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Locale-neutral date, e.g. "6 Aug 2026".
 *
 * Deliberately not toLocaleDateString. Two reasons:
 *
 * - The marketing pages are prerendered, so a locale-formatted date would be
 *   baked in using the build machine's locale and then disagree with what the
 *   browser renders — a hydration mismatch on every dated element.
 * - "08/06/2026" means two different days depending on where you live. Day
 *   followed by an abbreviated month is unambiguous everywhere.
 *
 * Read in UTC so a date-only string like "2026-08-06" cannot slip to the
 * previous day for anyone west of Greenwich.
 */
export function formatDate(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function daysBetween(from: Date | string, to: Date | string = new Date()): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86_400_000);
}
