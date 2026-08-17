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

/**
 * Other people's postings, in every shape LinkedIn ships them.
 *
 * The left-hand results list, "More jobs for you", "People also viewed",
 * "Similar jobs". Each one is a stack of job titles — "Angular Developer",
 * "Flutter Developer", ".NET Full Stack", "UI/UX Designer" — and a title is
 * mostly skill names, so a scrape that swallows one of these modules reads as
 * a posting demanding every technology on the page.
 *
 * The old class names are kept alongside the current ones. LinkedIn rotates
 * them and a stale entry costs nothing, while a missing one costs the whole
 * comparison.
 */
const OTHER_POSTINGS = [
  '.jobs-search-results-list',
  '.jobs-search-results',
  '[class*="search-results-list"]',
  '[class*="job-card-list"]',
  '[class*="job-card-container"]',
  '[class*="scaffold-layout__list"]',
  '[data-occludable-job-id]',
  '[class*="similar-jobs"]',
  '[class*="people-also-viewed"]',
  '[class*="browsemap"]',
  '[class*="jobs-recommend"]',
  '[class*="more-jobs"]',
].join(',');

/**
 * Regions inside a job page that are not the job.
 *
 * Stripped before the text is read, on every path.
 *
 * WHY THIS EXISTS
 *
 * A posting for a React role reported nine required skills, four of which —
 * Angular, Flutter, .NET, UI/UX — the posting never mentions. Its body names
 * exactly two, React and Next.js. The other seven came from the page around
 * it: other postings' titles from the recommendation rails, LinkedIn's own
 * "skills this job matches" widget, and the word "Accessibility" from
 * LinkedIn's global footer. The score was 5 of 9 — so more than three quarters
 * of what the panel called this posting's requirements came from text the
 * employer did not write, and the number underneath it was computed almost
 * entirely from page furniture.
 *
 * The structural fallback below used to budget for exactly this and call it
 * cheap: "the top card is a job title and a company name, which cost the match
 * a couple of stray skill names at worst". That was true of the top card and
 * false of everything else in the pane.
 *
 * Two categories beyond other postings:
 *
 *   - LinkedIn's *own* skills widget. It is the platform's guess at what this
 *     job needs, not the posting's words, and it is frequently spray-tagged by
 *     whoever posted the job. Reading it back as the posting's requirements
 *     launders a guess into a quotation.
 *   - Page chrome. LinkedIn's footer carries an "Accessibility" link on every
 *     page on the site, which is where an accessibility "requirement" appeared
 *     on a posting that says nothing about it.
 */
const NOT_THE_POSTING = [
  OTHER_POSTINGS,
  // LinkedIn's skills/how-you-match card.
  '#how-you-match-card-container',
  '[class*="how-you-match"]',
  '[class*="job-details-skill"]',
  '[class*="jobs-skill"]',
  /*
   * Page chrome.
   *
   * A bare `header` is deliberately not here. `nav`, `footer` and `aside` do
   * not appear inside a job description, but a semantic ATS that wraps its
   * posting in an `<article>` may well open it with a `<header>` holding the
   * role title — and stripping that would lose part of the posting to fix a
   * problem it was never causing. `[role="banner"]` covers the page-level case
   * that matters, which is the only one this is here for.
   */
  'nav',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[class*="global-nav"]',
  '[class*="global-footer"]',
].join(',');

function isSearchSidebar(el: Element): boolean {
  return Boolean(el.closest(OTHER_POSTINGS));
}

/**
 * The node's rendered text, minus the subtrees that are not the posting.
 *
 * The fast path is the important one: a node containing none of
 * `NOT_THE_POSTING` — which is every properly-named description container —
 * is read exactly as it was before, one `innerText` call and no walk. The
 * stripping only costs anything on the pages that need it.
 *
 * `innerText` rather than `textContent`, and that is why this walks the tree
 * instead of stripping a clone: innerText respects `display: none`, and these
 * containers routinely hold a hidden "read more" duplicate of the whole
 * description. textContent returns the posting twice — and a detached clone
 * has no layout, so innerText on one degrades to textContent and brings the
 * duplicate straight back.
 *
 * Newline-joined because the sectioning in `splitRequirements` reads line by
 * line: flattening the bullets into a paragraph loses the boundary between
 * "must have React" and the nice-to-have under it.
 */
function textWithout(node: Element, junk: string): string {
  if (!node.querySelector(junk)) {
    return (node as HTMLElement).innerText ?? node.textContent ?? '';
  }

  const parts: string[] = [];

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.textContent ?? '');
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const el = child as Element;
    if (el.matches(junk)) continue;
    parts.push(textWithout(el, junk));
  }

  return parts.join('\n');
}

function readable(node: Element | null): string | null {
  if (!node) return null;

  const raw = textWithout(node, NOT_THE_POSTING);
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

    /*
     * A dominant child that is itself a region we strip is not descended into.
     * On a pane whose recommendation rail outweighs the posting — a short
     * posting under "More jobs for you" does it — the descent would otherwise
     * end up *inside* the rail, and `readable` would then strip the only thing
     * left and report the page as unreadable. Stopping here keeps the posting
     * and drops the rail, which is the whole point.
     */
    const dominant = [...node.children].find(
      (child) =>
        !child.matches(NOT_THE_POSTING) && (child.textContent?.length ?? 0) >= total * 0.9
    );

    if (!dominant) return node;
    node = dominant;
  }

  return node;
}

/**
 * Where the last successful read came from.
 *
 * "The panel is showing skills this posting never mentions" is a report that
 * cannot be acted on without knowing which container produced the text, and
 * that container is on a page only the person reporting it can see.
 * `describeDescriptionMiss` already does this for the read that finds nothing;
 * this is the same idea for the read that finds the wrong thing, which is the
 * more dangerous of the two because it produces a confident number instead of
 * an obvious blank.
 */
let lastSource = '';

/** The selector, or the fallback, that produced the current description. */
export function descriptionSource(): string {
  return lastSource;
}

export function jobDescription(doc: Document, adapter: JobAdapter): string | null {
  lastSource = '';

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
        lastSource = selector;
        return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
      }
    }
  }

  // Fallback to structured JSON-LD data
  const jsonLd = descriptionFromJsonLd(doc);
  if (jsonLd && jsonLd.length >= MIN_USEFUL_LENGTH) {
    lastSource = 'json-ld';
    return jsonLd.length > MAX_LENGTH ? `${jsonLd.slice(0, MAX_LENGTH - 1)}…` : jsonLd;
  }

  /*
   * Every name missed and there is no structured data. Read the pane by shape.
   *
   * Reached only when the alternative is returning null, so it cannot make
   * anything worse: the caller's other option at this point is no comparison
   * at all. It still over-collects — on a details pane whose top card and body
   * are siblings this returns both — but only across the parts of the pane
   * that `NOT_THE_POSTING` leaves standing, which is the top card and the body.
   * A job title and a company name cost the match a stray skill name at worst.
   *
   * This used to refuse outright whenever the node still contained a results
   * list, on the grounds that the pane chain ends at `main` and `main` on a
   * two-pane layout wraps both columns. Stripping those modules is strictly
   * better than refusing over them: the same forty postings are kept out of
   * the comparison, and the one the user is actually looking at is still read.
   * The refusal also only ever worked against the class names it happened to
   * list, and LinkedIn had already moved past two of the three.
   *
   * The threshold is higher than MIN_USEFUL_LENGTH deliberately. A guess needs
   * to clear a bar a teaser cannot: 50 characters of unidentified text is as
   * likely to be a cookie banner as a posting. Measured after stripping, so a
   * pane that is nothing but recommendation rails now falls below it and the
   * card says it could not read the page — which is true, and better than a
   * confident score over other people's jobs.
   */
  if (detailsPane !== doc && !isSearchSidebar(detailsPane as Element)) {
    const node = contentNode(detailsPane as Element);

    const guess = readable(node);
    if (guess && guess.length >= MIN_GUESS_LENGTH) {
      lastSource = `shape:${node.tagName.toLowerCase()}.${node.className || '-'}`.slice(0, 120);
      return guess.length > MAX_LENGTH ? `${guess.slice(0, MAX_LENGTH - 1)}…` : guess;
    }
  }

  return null;
}
