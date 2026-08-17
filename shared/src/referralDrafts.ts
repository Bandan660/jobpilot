import type { ReferralAsk } from './types.js';

/**
 * Referral messages, from templates rather than from a model.
 *
 * The argument is the one that already won in `skills.ts`: this is four
 * sentences with five variables. A model buys nothing here, costs a request on
 * a free tier that runs out, takes seconds, and sends the user's history to a
 * third party for a task a string template does exactly. `/api/analyze/answer`
 * is also still returning 429.
 *
 * Nothing here sends anything. The draft is copied to the clipboard and the
 * user pastes it, edits it, and presses send themselves — which is both the
 * operating rule of this whole feature and, separately, the reason the message
 * has a chance of working. A referral ask that reads as generated is one that
 * gets ignored.
 *
 * WHY THE COPY IS DELIBERATELY PLAIN
 *
 * The temptation is to write something warm and flattering. It reads as
 * flattery, which is what the recipient has learned to filter — they get
 * several of these a week. What actually earns a reply is being short, saying
 * exactly what is being asked for, and making it easy to say no. All three
 * templates are built that way, and the note under them tells the user the one
 * thing worth adding, which is the sentence only they can write.
 */

/**
 * LinkedIn's cap on a connection-request note.
 *
 * A draft that silently exceeds it is one discovered with the dialog already
 * open and the message already pasted, so the note template is written to fit
 * and `fitsConnectionNote` exists to check it after the user has edited.
 * Free accounts are additionally limited to a handful of notes a month, which
 * is why the template does not assume one is available.
 */
export const CONNECTION_NOTE_LIMIT = 200;

export interface DraftContext {
  ask: Pick<ReferralAsk, 'name' | 'application'>;
  /** The user's own name, for the sign-off. */
  from: string | null;
}

/** First name only. "Hi Priya Raman," reads like a mail merge, because it is. */
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full.trim();
}

/**
 * The note that goes with a connection request.
 *
 * Under 200 characters by construction, including a long name and a long
 * company. It says who they are, what they want and that it is small — there
 * is no room for anything else, and nothing else belongs.
 */
export function connectionNote({ ask }: DraftContext): string {
  const note = `Hi ${firstName(ask.name)} — I'm applying for the ${
    ask.application.title
  } role at ${ask.application.company} and would really value a referral if you think I'd be a fit. Happy to send my CV.`;

  /*
   * Truncated rather than returned over the limit. The user can rewrite it;
   * what they must not get is a draft that looks fine here and is silently
   * rejected by the field they paste it into.
   */
  return note.length <= CONNECTION_NOTE_LIMIT
    ? note
    : `${note.slice(0, CONNECTION_NOTE_LIMIT - 1).trimEnd()}…`;
}

export function fitsConnectionNote(text: string): boolean {
  return text.trim().length <= CONNECTION_NOTE_LIMIT;
}

/**
 * The message after they accept.
 *
 * Longer than the note because there is room, and it does the one thing the
 * note could not: make refusing easy. "If you're not comfortable referring
 * someone you haven't worked with, I completely understand" is not politeness
 * for its own sake — it is what turns a request someone would ignore into one
 * they answer, and a no is worth more than silence.
 */
export function referralMessage({ ask, from }: DraftContext): string {
  const sign = from?.trim() ? `\n\nThanks,\n${from.trim()}` : '';

  return [
    `Hi ${firstName(ask.name)}, thanks for connecting.`,
    '',
    `I've applied for the ${ask.application.title} role at ${ask.application.company}. If you think it looks like a fit, a referral would mean a lot — happy to send my CV and a short note on why I'm interested.`,
    '',
    "If you'd rather not refer someone you haven't worked with, I completely understand.",
  ].join('\n') + sign;
}

/**
 * The single follow-up. There is no second one.
 *
 * Written to close itself out: it says this is the last message, which is the
 * only honest way to send a follow-up and the thing that makes it land as
 * considerate rather than as pressure. It also leaves the door open for later,
 * because the contact is the asset here, not this one application.
 */
export function followUpMessage({ ask, from }: DraftContext): string {
  const sign = from?.trim() ? `\n\n${from.trim()}` : '';

  return [
    `Hi ${firstName(ask.name)} — just floating this once in case it got buried.`,
    '',
    `Still keen on the ${ask.application.title} role at ${ask.application.company}. No worries at all if you'd rather not, or if now isn't a good time — I won't chase it again.`,
  ].join('\n') + sign;
}

/** The draft for whatever comes next, or null when nothing is owed. */
export function draftFor(
  status: ReferralAsk['status'],
  context: DraftContext
): { title: string; body: string; limit: number | null } | null {
  switch (status) {
    case 'INVITED':
      return {
        title: 'Note for the connection request',
        body: connectionNote(context),
        limit: CONNECTION_NOTE_LIMIT,
      };
    case 'CONNECTED':
      return { title: 'Message to send now', body: referralMessage(context), limit: null };
    case 'ASKED':
      return { title: 'Follow-up', body: followUpMessage(context), limit: null };
    default:
      return null;
  }
}
