import { descriptionFromJsonLd } from './jsonld.js';
import { squish, type JobAdapter } from './types.js';

/**
 * The posting text itself — the input the match analysis actually reasons over.
 *
 * Nothing else in the extension needed this. Capture stores a title, a company
 * and a location, because that is what a tracker row is; comparing a candidate
 * against a role needs the paragraphs nobody was reading.
 *
 * Three sources, in order of how much they can be trusted:
 *
 *   1. The adapter's own selector, where the platform has a stable container.
 *   2. `JobPosting.description` from structured data — contractual, published
 *      for Google Jobs, and survives the redesigns that break selectors.
 *   3. A heuristic over the page's own containers, which is a guess.
 *
 * The order is deliberately not the same as capture's. There, JSON-LD wins
 * because a title is a short value that structured data gets exactly right.
 * Here the adapter goes first: LinkedIn's JSON-LD description is frequently a
 * one-line summary while the pane holds the whole posting, and a short
 * description produces a confident analysis of almost nothing.
 */

/** Below this it is a teaser or a cookie notice, not a job description. */
const MIN_USEFUL_LENGTH = 200;

/**
 * The API caps this at 12,000 and truncating here rather than being rejected
 * keeps the failure quiet — job descriptions run to pages of boilerplate about
 * company values, and the requirements are near the top.
 */
const MAX_LENGTH = 12_000;

/** Containers a posting's body plausibly lives in, most specific first. */
const GENERIC_SELECTORS = [
  '#jobDescriptionText',
  '[data-testid="jobDescriptionText"]',
  '[class*="JobDescriptionText"]',
  '.jobsearch-JobComponent-description',
  '[class*="job-description"]',
  '[class*="jobDescription"]',
  '#job-details',
  '.jobs-description',
  '[data-automation-id="jobPostingDescription"]',
  '[class*="job-details"] [class*="description"]',
  '[class*="posting-description"]',
  '[itemprop="description"]',
  'article',
  'main',
];

function readable(node: Element | null): string | null {
  if (!node) return null;

  /*
   * innerText, not textContent: it respects `display: none`, and these
   * containers routinely hold a hidden "read more" duplicate of the whole
   * description. textContent returns the posting twice.
   */
  const raw = (node as HTMLElement).innerText ?? node.textContent ?? '';
  const cleaned = raw
    .split('\n')
    .map((line) => squish(line))
    .filter(Boolean)
    .join('\n')
    .trim();

  return cleaned.length >= MIN_USEFUL_LENGTH ? cleaned : null;
}

export function jobDescription(doc: Document, adapter: JobAdapter): string | null {
  const candidates: (string | null)[] = [];

  for (const selector of adapter.descriptionSelectors ?? []) {
    candidates.push(readable(doc.querySelector(selector)));
  }

  candidates.push(descriptionFromJsonLd(doc));

  for (const selector of GENERIC_SELECTORS) {
    candidates.push(readable(doc.querySelector(selector)));
  }

  /*
   * The longest of whatever cleared the floor, not the first.
   *
   * A selector matching a summary block and one matching the full posting both
   * pass the length check, and the difference between them is most of the
   * requirements. Length is a crude proxy for completeness, and it is the only
   * one available without understanding the content.
   */
  const best = candidates
    .filter((value): value is string => value !== null && value.length >= MIN_USEFUL_LENGTH)
    .sort((a, b) => b.length - a.length)[0];

  if (!best) return null;
  return best.length > MAX_LENGTH ? `${best.slice(0, MAX_LENGTH - 1)}…` : best;
}
