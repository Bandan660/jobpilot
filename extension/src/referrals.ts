import { canonicalizeProfileUrl, normalizeCompany, type ReferralAsk } from '@jobpilot/shared';
import { send } from './messages.js';

/**
 * The referral lookup index.
 *
 * Answers one question, on a LinkedIn profile: have I asked this person for a
 * referral, and about what? That is the whole of phase 2's payoff — see
 * `docs/REFERRALS.md`.
 *
 * WHY AN INDEX AND NOT A REQUEST PER PAGE
 *
 * The card has to be right the moment the profile renders, and a round trip
 * per profile makes it late on exactly the pages someone is clicking through
 * quickly. The list is small — one row per person the user has ever asked —
 * so it is fetched whole and matched offline.
 *
 * WHY IT EXPIRES
 *
 * The same lesson `loadProfile` in `content.ts` had to learn the hard way:
 * "fetched once per page" is once per *tab*, and a LinkedIn tab lives for
 * hours. Log an ask on the dashboard, come back to the tab, and a cache with
 * no TTL says "you have not asked them" about someone you logged five minutes
 * ago — which is worse than showing nothing, because it is a confident wrong
 * answer on the one screen this feature exists for.
 *
 * Tab re-focus is the reliable signal that something changed elsewhere, and it
 * is what `invalidateReferrals()` is wired to below.
 */

const REFERRAL_TTL_MS = 60_000;

let cache: ReferralAsk[] | null = null;
let cachedAt = 0;
/** In flight, so a burst of profile navigations shares one request. */
let pending: Promise<ReferralAsk[] | null> | null = null;

export function invalidateReferrals(): void {
  cache = null;
  cachedAt = 0;
}

/*
 * Both events, for the same reason the profile cache watches both: a
 * background tab that never regains focus can still become visible, and a
 * window focus does not always fire a visibility change.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') invalidateReferrals();
});
window.addEventListener('focus', () => invalidateReferrals());

export async function loadReferrals(): Promise<ReferralAsk[] | null> {
  if (cache && Date.now() - cachedAt < REFERRAL_TTL_MS) return cache;
  if (pending) return pending;

  pending = send<{ referrals: ReferralAsk[] }>({ type: 'GET_REFERRALS' })
    .then((result) => {
      if (!result.ok) return null;
      cache = result.data.referrals;
      cachedAt = Date.now();
      return cache;
    })
    /*
     * Not cached on failure. A signed-out tab, an offline moment or a 500 must
     * not pin "you have no asks" in front of the user for a minute — the next
     * paint should try again.
     */
    .catch(() => null)
    .finally(() => {
      pending = null;
    });

  return pending;
}

/**
 * The asks aimed at whoever this URL identifies, newest first.
 *
 * Both sides of the comparison run `canonicalizeProfileUrl`: the API computed
 * `profileKey` from what the user pasted, this computes one from the address
 * bar. That function lives in `shared/` precisely so the two cannot spell the
 * key differently — a mismatch here does not throw, it silently shows nothing.
 *
 * Returns every match rather than the first. The same person can be asked
 * about two roles, and a card naming only one of them would be wrong in the
 * most confusing possible way.
 */
export function asksForProfile(referrals: ReferralAsk[], pageUrl: string): ReferralAsk[] {
  const key = canonicalizeProfileUrl(pageUrl);
  if (!key) return [];

  return referrals
    .filter((ask) => ask.profileKey === key)
    .sort((a, b) => b.statusAt.localeCompare(a.statusAt));
}

/**
 * How many asks are already logged at this company, across every application.
 *
 * Company rather than application, because the panel shows on postings that
 * have no application yet — and "you have already asked two people here" is
 * the useful fact either way. Matched on `normalizeCompany`, the same key
 * duplicate detection uses, so "Tata Consultancy" and "Tata Consultancy
 * Services Ltd." count as one employer.
 *
 * Zero on any failure. This number decorates a sentence; it must never be the
 * reason the card does not render.
 */
export function asksAtCompany(company: string | null | undefined): number {
  const key = normalizeCompany(company);
  if (!key) return 0;

  /*
   * Synchronous, off the cache, and it never triggers a fetch.
   *
   * This runs inside `maybeShowPanel`, which already awaits the session and
   * the profile before it can draw anything. Awaiting the referral index there
   * too would put a third round trip in front of every paint on a cold cache —
   * so the whole panel would wait on a number that decorates one sentence.
   *
   * `warmReferrals()` fills the cache in the background instead, and the
   * panel repaints often enough on LinkedIn that the count appears within a
   * beat. Zero in the meantime reads as "none logged", which is also what the
   * card says when there genuinely are none — the sentence is written so both
   * are true.
   */
  const referrals = cachedReferrals();
  if (!referrals) return 0;

  return referrals.filter((ask) => normalizeCompany(ask.application.company) === key).length;
}

/** The index if it is loaded and fresh. Never fetches. */
export function cachedReferrals(): ReferralAsk[] | null {
  return cache && Date.now() - cachedAt < REFERRAL_TTL_MS ? cache : null;
}

/** Start the fetch without waiting for it. Safe to call on every paint. */
export function warmReferrals(): void {
  void loadReferrals();
}

/** True on a LinkedIn member profile — the only page the card belongs on. */
export function isProfilePage(url: URL): boolean {
  return canonicalizeProfileUrl(url.href) !== null;
}
