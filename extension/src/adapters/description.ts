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
const MIN_USEFUL_LENGTH = 50;

/**
 * The bar for text found by shape rather than by name.
 *
 * A named container is evidence in itself — someone called it the description.
 * An unnamed block is a guess, and a guess has to look like a posting before it
 * is believed.
 */
const MIN_GUESS_LENGTH = 400;

/**
 * The API caps this at 12,000 and truncating here rather than being rejected
 * keeps the failure quiet — job descriptions run to pages of boilerplate about
 * company values, and the requirements are near the top.
 */
const MAX_LENGTH = 12_000;

/** Containers a posting's body plausibly lives in, most specific first. */
const GENERIC_SELECTORS = [
  '#job-details',
  '.jobs-description__content',
  '.jobs-box__html-content',
  '.jobs-description-content',
  '.jobs-description',
  '#jobDescriptionText',
  '[data-testid="jobDescriptionText"]',
  '[class*="JobDescriptionText"]',
  '.jobsearch-JobComponent-description',
  '[class*="job-description"]',
  '[class*="jobDescription"]',
  '[data-automation-id="jobPostingDescription"]',
  '[class*="job-details"] [class*="description"]',
  '[class*="posting-description"]',
  '[itemprop="description"]',
];

function isSearchSidebar(el: Element): boolean {
  return Boolean(
    el.closest(
      '.jobs-search-results-list, .jobs-search-results, [class*="search-results-list"], [class*="job-card-list"]'
    )
  );
}

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

/**
 * The content node inside a wrapper, found by shape rather than by name.
 *
 * Descends while a single child holds almost all of the text. Layout wrappers
 * have exactly that property — one meaningful child and nothing else — so this
 * walks past however many of them a framework has stacked up and stops at the
 * node where the content actually branches into paragraphs and bullets.
 *
 * It is the answer to a class of failure that keeps recurring here: every
 * selector in this file is a name LinkedIn chose, LinkedIn rotates its names
 * without notice, and when they all miss the scrape returns null and the panel
 * has nothing to compare. Shape survives a rename.
 */
function contentNode(root: Element): Element {
  let node = root;

  for (let depth = 0; depth < 12; depth += 1) {
    const total = node.textContent?.length ?? 0;
    if (total === 0) return node;

    const dominant = [...node.children].find(
      (child) => (child.textContent?.length ?? 0) >= total * 0.9
    );

    if (!dominant) return node;
    node = dominant;
  }

  return node;
}

export function jobDescription(doc: Document, adapter: JobAdapter): string | null {
  /*
   * `main` is last before giving up, and it is the one entry here that is not
   * a name someone can rename. `extract()` in the LinkedIn adapter already
   * falls back to it for the same reason. Without it, a rotation of the hashed
   * pane classes leaves `detailsPane` as the whole document — which also
   * disables the structural fallback at the bottom of this function, since that
   * refuses to guess across an entire page.
   */
  const detailsPane =
    doc.querySelector('.jobs-search__job-details') ??
    doc.querySelector('.jobs-search-two-pane__details') ??
    doc.querySelector('.jobs-details__main-content') ??
    doc.querySelector('.job-view-layout') ??
    doc.querySelector('[class*="job-details"]') ??
    doc.querySelector('main') ??
    doc;

  const selectors = [
    ...(adapter.descriptionSelectors ?? []),
    ...GENERIC_SELECTORS,
  ];

  for (const selector of selectors) {
    const candidates = Array.from(detailsPane.querySelectorAll(selector))
      .concat(Array.from(doc.querySelectorAll(selector)))
      .filter((el) => !isSearchSidebar(el));

    for (const el of candidates) {
      const text = readable(el);
      if (text && text.length >= MIN_USEFUL_LENGTH) {
        return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
      }
    }
  }

  // Fallback to structured JSON-LD data
  const jsonLd = descriptionFromJsonLd(doc);
  if (jsonLd && jsonLd.length >= MIN_USEFUL_LENGTH) {
    return jsonLd.length > MAX_LENGTH ? `${jsonLd.slice(0, MAX_LENGTH - 1)}…` : jsonLd;
  }

  /*
   * Every name missed and there is no structured data. Read the pane by shape.
   *
   * Reached only when the alternative is returning null, so it cannot make
   * anything worse: the caller's other option at this point is no comparison
   * at all. It can over-collect — on a details pane whose top card and body are
   * siblings this returns both — and that is an acceptable trade, because the
   * top card is a job title and a company name, which cost the match a couple
   * of stray skill names at worst.
   *
   * The threshold is higher than MIN_USEFUL_LENGTH deliberately. A guess needs
   * to clear a bar a teaser cannot: 50 characters of unidentified text is as
   * likely to be a cookie banner as a posting.
   */
  if (detailsPane !== doc && !isSearchSidebar(detailsPane as Element)) {
    const node = contentNode(detailsPane as Element);

    /*
     * A node still containing the results list is the search page, not a
     * posting. Reachable because the pane chain now ends at `main`, which on
     * a two-pane layout wraps both columns — and forty other postings' skills
     * would produce a confident comparison against nothing the user is looking
     * at. Refusing here just means the card says it could not read the page,
     * which is true and harmless.
     */
    const swallowedList = node.querySelector(
      '.jobs-search-results-list, .jobs-search-results, [class*="job-card-list"]'
    );

    const guess = swallowedList ? null : readable(node);
    if (guess && guess.length >= MIN_GUESS_LENGTH) {
      return guess.length > MAX_LENGTH ? `${guess.slice(0, MAX_LENGTH - 1)}…` : guess;
    }
  }

  return null;
}
