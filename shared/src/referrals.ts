import type { ReferralAsk, ReferralStatus } from './types.js';

/**
 * When a referral ask needs something doing, and what.
 *
 * ONE DEFINITION, LIKE `fitBand`
 *
 * The badge on the toolbar, the card on a LinkedIn profile and the tracker row
 * all have to agree on what is due. Three places deciding it independently is
 * how they drift, and the drift is invisible: a badge saying 3 over a dashboard
 * showing 2 does not error, it just stops being trusted.
 *
 * DERIVED, NEVER STORED
 *
 * Nothing here writes a status. "Gone cold" in particular is computed from the
 * clock rather than recorded, exactly as ghosting is derived from posting
 * liveness against application status — so a reply that arrives on day six
 * clears it by itself when the user moves the ask to REFERRED, with nothing to
 * un-set.
 *
 * That is also why the scheduled sweep does not write these. With the rule
 * here, every surface computes the same answer from data it already has; a
 * cron writing `FOLLOW_UP_DUE` rows would add a second source of truth and a
 * dedupe problem, for no reader that cannot already answer the question. It
 * becomes worth building the day there is a push channel — email — and not
 * before.
 */

/**
 * The statuses that end an ask.
 *
 * One definition, because three places ask the question and they must agree:
 * `referralDue` returns nothing for these, the badge therefore never counts
 * them, and the profile card refuses to draw for them at all.
 *
 * `COLD` is here as a status the *user* set — "no response, I am done with
 * this". It is not written by anything automatic; the derived version of gone
 * quiet is `ReferralDue.stale`, which is computed from the clock so a late
 * reply clears it by itself.
 */
export const REFERRAL_CLOSED: readonly ReferralStatus[] = ['REFERRED', 'DECLINED', 'COLD'];

/** Is this ask finished — referred, declined, or given up on? */
export function isReferralClosed(status: ReferralStatus): boolean {
  return REFERRAL_CLOSED.includes(status);
}

/** What the user should do next, when anything. */
export type ReferralAction =
  /** They accepted and have not been asked yet. */
  | 'ASK'
  /** Asked, no reply, past the point where a nudge is the polite move. */
  | 'NUDGE'
  /**
   * The invitation has been sitting unanswered long enough that it is probably
   * not coming. Not an action on the contact — an invitation to stop waiting.
   */
  | 'EXPIRED';

/**
 * Hours from the last status change to the next thing being due.
 *
 * These are judgement, not measurement, and each is set where the advice
 * changes rather than at a round number:
 *
 * - 24h after they accept. Accepting is a small favour freely given, and the
 *   window where a message reads as "thanks for connecting" rather than "who
 *   is this" is about a day.
 * - 48h after asking. Under that is pestering someone who has a job; much over
 *   it and the conversation has gone cold enough that the nudge reads as new.
 * - 21 days on an unanswered invitation, which is roughly when LinkedIn stops
 *   showing it prominently and well past the point of expecting an answer.
 */
const DUE_HOURS: Partial<Record<ReferralStatus, { hours: number; action: ReferralAction }>> = {
  CONNECTED: { hours: 24, action: 'ASK' },
  ASKED: { hours: 48, action: 'NUDGE' },
  INVITED: { hours: 21 * 24, action: 'EXPIRED' },
};

/**
 * How long after a nudge to stop counting on a reply.
 *
 * There is no second nudge — two is pestering, and it costs the contact for
 * every future role at that company, which is the asset actually being built.
 * So `NUDGED` has no due action at all; it only goes quiet.
 */
const STALE_AFTER_NUDGE_HOURS = 5 * 24;

export interface ReferralDue {
  /** What to do, or null when there is nothing to do and nothing to wait for. */
  action: ReferralAction | null;
  /** When it becomes due. Null for terminal statuses. */
  dueAt: string | null;
  /** Is it due now? */
  isDue: boolean;
  /** Whole days past `dueAt`. Zero when not yet due. */
  overdueDays: number;
  /**
   * Past the point where a reply is likely, and nothing left to do about it.
   * Derived from the clock, never written — a reply on day six clears it by
   * itself.
   */
  stale: boolean;
}

const NOTHING: ReferralDue = {
  action: null,
  dueAt: null,
  isDue: false,
  overdueDays: 0,
  stale: false,
};

const HOUR_MS = 60 * 60 * 1000;

export function referralDue(
  ask: Pick<ReferralAsk, 'status' | 'statusAt'>,
  now: Date = new Date()
): ReferralDue {
  // A user-set ending. Nothing is due on an ask that has an answer.
  if (isReferralClosed(ask.status)) return NOTHING;

  const since = Date.parse(ask.statusAt);
  // An unparseable timestamp must not produce a due date from NaN, which
  // compares false against everything and would silently mean "never due".
  if (!Number.isFinite(since)) return NOTHING;

  if (ask.status === 'NUDGED') {
    const stale = now.getTime() - since >= STALE_AFTER_NUDGE_HOURS * HOUR_MS;
    return { ...NOTHING, stale };
  }

  const rule = DUE_HOURS[ask.status];
  if (!rule) return NOTHING;

  const dueMs = since + rule.hours * HOUR_MS;
  const elapsed = now.getTime() - dueMs;

  return {
    action: rule.action,
    dueAt: new Date(dueMs).toISOString(),
    isDue: elapsed >= 0,
    overdueDays: elapsed > 0 ? Math.floor(elapsed / (24 * HOUR_MS)) : 0,
    /*
     * An unanswered invitation past 21 days is the one "due" that is really an
     * ending. Marked stale as well as due so a surface can choose to show it
     * quietly rather than as a task.
     */
    stale: rule.action === 'EXPIRED' && elapsed >= 0,
  };
}

/** Everything needing action right now, most overdue first. */
export function dueReferrals(asks: ReferralAsk[], now: Date = new Date()): ReferralAsk[] {
  return asks
    .map((ask) => ({ ask, due: referralDue(ask, now) }))
    /*
     * `EXPIRED` is excluded from the count on purpose. The badge is a list of
     * things to do, and "an invitation from three weeks ago went unanswered"
     * is not one — surfacing it as a task would put a number on the toolbar
     * that pressing it cannot clear.
     */
    .filter((row) => row.due.isDue && row.due.action !== 'EXPIRED')
    .sort((a, b) => b.due.overdueDays - a.due.overdueDays)
    .map((row) => row.ask);
}

/** What the user is being asked to do, in the fewest words that are still true. */
export const REFERRAL_ACTION_LABEL: Record<ReferralAction, string> = {
  ASK: 'Send the ask',
  NUDGE: 'Follow up',
  EXPIRED: 'No answer',
};
