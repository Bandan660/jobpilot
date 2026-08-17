import type { CapturedJob } from '@jobpilot/shared';

/**
 * "I went looking for someone to refer me to this job."
 *
 * WHY AN INTENT EXISTS AT ALL
 *
 * The log-an-ask form has to appear on a LinkedIn profile — that is where the
 * name, the headline and the URL already are, and where the user is standing
 * the moment after they press Connect. But a form on *every* profile on
 * LinkedIn is noise: most profiles someone opens have nothing to do with a job
 * search, and a panel that asks "log an ask?" over an old colleague's holiday
 * photos is the kind of thing people uninstall an extension over.
 *
 * So it needs a trigger, and there is a precise one available. Pressing one of
 * the panel's referral searches says, unambiguously and in the user's own
 * click, "I am about to go and find someone at this company". Every profile
 * opened in the window after that is a candidate, and every profile opened
 * outside it is not.
 *
 * This is also why the trigger is not "read the company off the profile page".
 * That would need a DOM selector on a surface LinkedIn redesigns often, to
 * recover a fact the user's own click already established.
 *
 * WHAT IS STORED
 *
 * The whole `CapturedJob`, not an application id. The card shows on postings
 * that have never been applied to, so there may be no application yet — the
 * API resolves-or-creates one from this payload, exactly as capture does, and
 * creates it as SAVED when it has to.
 */

export interface ReferralIntent {
  job: CapturedJob;
  /** Which search was opened. Shown back to the user, never acted on. */
  searchLabel: string;
  /** Epoch millis. */
  at: number;
}

const KEY = 'referralIntent';

/**
 * Long enough to find someone and send a request; short enough that tomorrow's
 * unrelated browsing is not still being offered yesterday's job.
 *
 * Thirty minutes is a guess, and a deliberately generous one — the cost of it
 * being too long is one dismissible card, and the cost of it being too short
 * is the form missing the exact moment it was built for.
 */
const INTENT_TTL_MS = 30 * 60 * 1000;

/** `chrome.storage.local`, so the intent survives the tab change to LinkedIn. */
export async function rememberIntent(job: CapturedJob, searchLabel: string): Promise<void> {
  const intent: ReferralIntent = { job, searchLabel, at: Date.now() };
  try {
    await chrome.storage.local.set({ [KEY]: intent });
  } catch {
    // A failed write costs the prefilled form, not the feature: the dashboard
    // path still works. Never let it break the click that opened the search.
  }
}

export async function currentIntent(): Promise<ReferralIntent | null> {
  try {
    const stored = (await chrome.storage.local.get(KEY))[KEY] as ReferralIntent | undefined;
    if (!stored?.job) return null;
    if (Date.now() - stored.at > INTENT_TTL_MS) return null;
    return stored;
  } catch {
    return null;
  }
}

export async function clearIntent(): Promise<void> {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    /* Nothing useful to do; the TTL clears it either way. */
  }
}
