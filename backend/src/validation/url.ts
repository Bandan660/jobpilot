import { z } from 'zod';

/**
 * A URL this system is willing to store, link to, or fetch.
 *
 * WHY `z.string().url()` IS NOT THAT
 *
 * It asks one question — does `new URL()` parse this — and the answer is yes
 * for a great deal more than a web address:
 *
 *   javascript:alert(1)                 parses
 *   data:text/html,<script>…</script>   parses
 *   file:///etc/passwd                  parses
 *
 * Two things in this codebase consume stored URLs, and both are harmed by
 * that. The dashboard renders them as `href`, where React 18 will happily emit
 * a `javascript:` link — a stored XSS in the reader's own session, arriving
 * through a CSV import or a captured posting. And the sweep worker *fetches*
 * them on a schedule, which turns a stored `http://10.0.0.1/` into an
 * outbound request nobody asked for.
 *
 * So the scheme is checked, because the scheme is what actually matters.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** `z.string().url()` with the scheme actually checked. */
export function httpUrl(max: number) {
  return z
    .string()
    .max(max)
    .refine(isHttpUrl, 'Must be an http:// or https:// URL');
}

/**
 * Hosts the posting sweep will not fetch.
 *
 * The sweep follows a URL the *user* supplied, on a timer, from Cloudflare's
 * network — so anything stored here is a request someone else can make this
 * Worker send. Workers cannot reach RFC1918 space or a metadata service, which
 * caps the damage well below classic SSRF, but "the platform happens to stop
 * it" is not a control this codebase owns. These are refused here as well.
 *
 * Deliberately a host check and not a DNS resolution: resolving to compare
 * addresses invites a TOCTOU rebind between the check and the fetch, and the
 * value of catching that here does not justify pretending it is airtight.
 */
const BLOCKED_HOST = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i,
];

/** Safe for the sweep worker to fetch: http(s), and not pointed inward. */
export function isFetchableUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false;

  try {
    const { hostname } = new URL(value);
    return !BLOCKED_HOST.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

/**
 * A LinkedIn profile URL, or nothing.
 *
 * Deliberately not `httpUrl()`: people paste "linkedin.com/in/priya-raman"
 * without a scheme far more often than they paste a full URL, and rejecting
 * that is a validation error on the one field the form asked them to copy.
 * Normalised to https here so the lookup in phase 2 has one shape to match.
 */
export function normalizeProfileUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.protocol = 'https:';
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
