/**
 * Links out to HireFresher, our separate free ATS resume builder.
 *
 * It stays a separate site on purpose: a resume builder is used intensely for a
 * few days and then finished, while a tracker is used for months. Merging them
 * would bloat both. So these are plain outbound links — no embed, no shared
 * account.
 *
 * Two things shape the copy here.
 *
 * HireFresher targets Indian freshers (B.Tech samples, rupee pricing) while
 * jobpilot is worldwide. So every link names what it actually is rather than
 * saying "Resume Builder", letting someone it does not suit skip it instead of
 * bouncing off a page that was never meant for them.
 *
 * And the destination is per-placement, not always the homepage: someone who
 * has just uploaded a resume wants its ATS score, not a blank builder.
 *
 * Deliberately NOT rel="nofollow" — it is our own property and the link should
 * pass authority to it.
 */

const BASE = 'https://hirefresher.in';

/**
 * `medium` distinguishes the placements in analytics. Without it every visit
 * collapses into one "jobpilot" number and there is no way to tell which
 * placement earned its space and which is only taking up room.
 */
export function resumeBuilderUrl(path: '/' | '/resume/new' | '/ats-checker', medium: string): string {
  return `${BASE}${path}?utm_source=jobpilot&utm_medium=${medium}&utm_campaign=cross_promo`;
}

export const RESUME_BUILDER_NAME = 'HireFresher';
