import type { Profile } from '@jobpilot/shared';
import { autofill } from './index.js';
import { findBlockers, labelFor, type Blocker } from './blockers.js';
import { attachResume, findResumeInput, type StoredResume } from './resume.js';
import { fillControl, highlight } from './fill.js';
import { send } from '../messages.js';

/**
 * Assisted apply: fill the form, attach the resume, draft what it can, and
 * either stop at the submit button or press it.
 *
 * WHERE IT STOPS
 *
 * At the submit button, unless the caller passes `autoSubmit`. That default is
 * the important half: everything in this codebase that fills a form without
 * being asked — the panel's Fill, the coverage preview — cannot send anything,
 * and cannot be made to by a change somewhere else. Sending is one flag on one
 * call path, which is what makes the question "can this send an application
 * without me" answerable by reading a single file.
 *
 * With `autoSubmit` on, the queue in `autoapply/queue.ts` runs hands-off. That
 * was a deliberate product decision, taken with the Web Store and LinkedIn
 * rate-limiting risks understood — see the note in CLAUDE.md before changing
 * it back.
 *
 * It stops rather than guessing either way. A required question the profile
 * cannot answer ends the attempt with that question named, and specifically
 * does NOT submit: an incomplete application sent is worse than one not sent,
 * because it burns the posting. The blocker check runs again immediately
 * before the click, not once at the start.
 *
 * ONE DRIVER, SEVERAL FLOWS
 *
 * Greenhouse and Lever are one page: fill, attach, done, and the loop below
 * runs exactly once. Workday and Ashby paginate. LinkedIn paginates inside a
 * modal it has to be asked to open. Those differences are the `ApplyFlow`
 * config and nothing else — the fill/attach/check/advance sequence is the same
 * on all of them, and keeping it in one place is what stops the platforms
 * drifting apart the way their adapters would.
 */

export type ApplyStatus =
  | 'opening'
  | 'filling'
  | 'attaching'
  | 'drafting'
  | 'advancing'
  | 'submitting'
  | 'submitted'
  | 'blocked'
  | 'ready'
  | 'cancelled'
  | 'error';

export interface ApplyProgress {
  status: ApplyStatus;
  step: number;
  message: string;
  blockers?: Blocker[];
  filled?: number;
}

export interface ApplyFlow {
  name: string;
  /** Where the form is. Null means "not on screen yet". */
  scope(): ParentNode | null;
  /** Reveal the form, for platforms that hide it behind a button. */
  open?(): Promise<boolean>;
  /** Whether to look for a next-step button at all. */
  multiStep: boolean;
  advance: RegExp[];
  submit: RegExp[];
}

export interface ApplyOptions {
  profile: Profile;
  flow: ApplyFlow;
  onProgress: (progress: ApplyProgress) => void;
  isCancelled: () => boolean;
  /** Off unless the user asked: it costs an API call per question. */
  draftAnswers?: boolean;
  job?: { title: string | null; company: string | null; jobUrl: string };
  /**
   * Press submit instead of stopping in front of it.
   *
   * OFF BY DEFAULT, AND EVERY CALLER MUST SAY OTHERWISE IN SO MANY WORDS.
   *
   * This used to be impossible on purpose. It is now a setting because
   * hands-off bulk applying is what the product is for, but the shape of the
   * code keeps the old guarantee available: one flag, one call site, one place
   * to look when asking "can this thing send an application without me".
   *
   * The two conditions below are not negotiable and are checked immediately
   * before the click, not inherited from earlier in the run:
   *
   *   - `findBlockers` is empty. An unanswered required question means the
   *     application is incomplete, and sending an incomplete application is
   *     worse than sending none.
   *   - the run was not cancelled. Stop must stop, including in the last
   *     hundred milliseconds.
   */
  autoSubmit?: boolean;
  /**
   * Called with the form still on screen, immediately before the click.
   *
   * The only moment the filled form exists: a successful submit replaces the
   * whole dialog, so anything worth reading off it — what the user answered by
   * hand, for instance — has to be read here or not at all.
   *
   * Runs after the blocker check, so it never sees a form that is about to be
   * refused.
   */
  beforeSubmit?: (scope: ParentNode) => void;
}

const MAX_STEPS = 12;
const SETTLE_MS = 250;
const ADVANCE_TIMEOUT_MS = 6000;
/* Longer than an advance: the server round trip is part of this one. */
const SUBMIT_TIMEOUT_MS = 12_000;
/** Per run, not per step. Each one is a model call and a few seconds. */
const MAX_DRAFTS = 3;
/** Below this a textarea is a short field, not an essay question. */
const OPEN_QUESTION_MIN_LABEL = 12;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function trace(...args: unknown[]): void {
  console.info('[jobpilot] apply:', ...args);
}

async function waitFor<T>(read: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await sleep(120);
  }
  return null;
}

function visible(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** By aria-label first, then visible text: the two things a redesign keeps. */
export function findButton(root: ParentNode, patterns: RegExp[]): HTMLButtonElement | null {
  const buttons = [
    ...root.querySelectorAll<HTMLButtonElement>('button, input[type="submit"], [role="button"]'),
  ].filter((b) => !(b as HTMLButtonElement).disabled && visible(b));

  for (const pattern of patterns) {
    const byLabel = buttons.find((b) => pattern.test(b.getAttribute('aria-label') ?? ''));
    if (byLabel) return byLabel;

    const byText = buttons.find((b) =>
      pattern.test((b.textContent?.trim() || (b as HTMLInputElement).value) ?? '')
    );
    if (byText) return byText;
  }
  return null;
}

/**
 * Empty free-text questions worth drafting an answer to.
 *
 * Textareas only. A long question in a single-line input is a mislabelled
 * field, not an essay, and writing 90 words into one is not a favour.
 */
function openQuestions(scope: ParentNode): { control: HTMLTextAreaElement; label: string }[] {
  return [...scope.querySelectorAll<HTMLTextAreaElement>('textarea')]
    .filter((control) => !control.disabled && !control.readOnly && visible(control))
    .filter((control) => control.value.trim() === '')
    .map((control) => ({ control, label: labelFor(control, scope) }))
    .filter(({ label }) => label.length >= OPEN_QUESTION_MIN_LABEL);
}

export async function runApply({
  profile,
  flow,
  onProgress,
  isCancelled,
  draftAnswers = false,
  job,
  autoSubmit = false,
  beforeSubmit,
}: ApplyOptions): Promise<ApplyProgress> {
  const report = (progress: ApplyProgress): ApplyProgress => {
    trace(flow.name, progress.status, `step ${progress.step}`, progress.message);
    onProgress(progress);
    return progress;
  };

  let scope = flow.scope();

  if (!scope && flow.open) {
    report({ status: 'opening', step: 0, message: 'Opening the application…' });
    const opened = await flow.open();
    if (opened) scope = await waitFor(() => flow.scope(), 8000);
  }

  if (!scope) {
    return report({
      status: 'error',
      step: 0,
      message: 'No application form on this page. Open the apply page first.',
    });
  }

  let totalFilled = 0;
  let resumeAttached = false;
  let drafted = 0;

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    if (isCancelled()) return report({ status: 'cancelled', step, message: 'Stopped.' });

    const current = flow.scope();
    if (!current) {
      return report({ status: 'error', step, message: 'The application form went away.' });
    }
    scope = current;

    /* ------------------------------- fill ------------------------------- */

    report({ status: 'filling', step, message: `Filling${flow.multiStep ? ` step ${step}` : ''}…` });

    const filled = autofill(profile, { root: scope, showHighlights: true });
    totalFilled += filled.filled;
    trace(`filled ${filled.filled}, skipped ${filled.skipped}`);

    /* ------------------------------ resume ------------------------------ */

    if (!resumeAttached && findResumeInput(scope)) {
      report({ status: 'attaching', step, message: 'Attaching your resume…' });

      const stored = await send<StoredResume | null>({ type: 'GET_RESUME' });
      if (!stored.ok) {
        trace('resume unavailable:', stored.error);
      } else if (!stored.data) {
        trace('no resume on file');
      } else {
        const outcome = attachResume(stored.data, { scope });
        trace('resume:', outcome.status);
        // 'already-attached' counts: the field is satisfied either way, and
        // retrying it on every subsequent step would be noise.
        resumeAttached = outcome.status === 'attached' || outcome.status === 'already-attached';
      }
    }

    /* ------------------------------ drafts ------------------------------ */

    if (draftAnswers && job && drafted < MAX_DRAFTS) {
      for (const question of openQuestions(scope)) {
        if (drafted >= MAX_DRAFTS || isCancelled()) break;

        report({
          status: 'drafting',
          step,
          message: `Drafting an answer to "${question.label.slice(0, 48)}"…`,
        });

        const draft = await send<{ answer: string }>({
          type: 'DRAFT_ANSWER',
          payload: { question: question.label, ...job },
        });

        if (!draft.ok) {
          trace('draft failed:', draft.error);
          break; // Rate limited or unconfigured: the next one will fail too.
        }

        // An empty answer is the model declining to invent one. Leave the box
        // blank — that is the honest outcome and the user can see it.
        if (!draft.data.answer) {
          trace('no basis for:', question.label);
          continue;
        }

        if (fillControl(question.control, draft.data.answer, false) === 'filled') {
          highlight(question.control);
          drafted += 1;
        }
      }
    }

    // Let the page's own validation run against what was just typed.
    await sleep(SETTLE_MS);

    /* ----------------------------- blockers ----------------------------- */

    const blockers = findBlockers(scope);
    if (blockers.length > 0) {
      trace('blocked by:', blockers.map((b) => b.label));
      return report({
        status: 'blocked',
        step,
        filled: totalFilled,
        blockers,
        message: `${blockers.length} thing${blockers.length === 1 ? '' : 's'} still need${
          blockers.length === 1 ? 's' : ''
        } you.`,
      });
    }

    /* ------------------------------ finish ------------------------------ */

    const submitButton = findButton(scope, flow.submit);

    if (submitButton) {
      if (!autoSubmit) {
        return report({
          status: 'ready',
          step,
          filled: totalFilled,
          message: `Ready to send — ${totalFilled} field${totalFilled === 1 ? '' : 's'} filled${
            resumeAttached ? ', resume attached' : ''
          }. Review it, then submit.`,
        });
      }

      /*
       * Re-checked here rather than trusted from above. Both conditions can
       * change during the fill — a draft can fail, the page can render a
       * validation error, the user can press stop — and this is the last
       * moment where any of that can still be acted on.
       */
      const lastLook = findBlockers(scope);
      if (lastLook.length > 0) {
        trace('refusing to submit, unanswered:', lastLook.map((b) => b.label));
        return report({
          status: 'blocked',
          step,
          filled: totalFilled,
          blockers: lastLook,
          message: 'Not sent — this one still needs you.',
        });
      }

      if (isCancelled()) return report({ status: 'cancelled', step, message: 'Stopped.' });

      beforeSubmit?.(scope);

      report({ status: 'submitting', step, message: 'Sending the application…' });
      submitButton.click();

      /*
       * Confirmed by the page, not by the click. A click that the form
       * rejected leaves the submit button exactly where it was, and counting
       * that as sent is how a run reports fifty applications and delivers
       * none.
       */
      const sent = await waitFor(() => {
        const now = flow.scope();
        if (!now) return true; // The dialog closed — the usual success signal.
        return findButton(now, flow.submit) === null ? true : null;
      }, SUBMIT_TIMEOUT_MS);

      if (!sent) {
        return report({
          status: 'blocked',
          step,
          filled: totalFilled,
          message: 'Pressed submit but the form did not accept it.',
        });
      }

      return report({
        status: 'submitted',
        step,
        filled: totalFilled,
        message: `Sent — ${totalFilled} field${totalFilled === 1 ? '' : 's'} filled${
          resumeAttached ? ', resume attached' : ''
        }.`,
      });
    }

    if (!flow.multiStep) {
      return report({
        status: 'ready',
        step,
        filled: totalFilled,
        message: `Filled ${totalFilled} field${totalFilled === 1 ? '' : 's'}${
          resumeAttached ? ' and attached your resume' : ''
        }. Check it over before you submit.`,
      });
    }

    /* ------------------------------ advance ----------------------------- */

    const next = findButton(scope, flow.advance);
    if (!next) {
      trace(
        'no advance button. buttons present:',
        [...scope.querySelectorAll('button')].map(
          (b) => `${b.getAttribute('aria-label') ?? ''}|${b.textContent?.trim() ?? ''}`
        )
      );
      return report({
        status: 'blocked',
        step,
        filled: totalFilled,
        message: 'Could not find the button to continue. Finish this step yourself.',
      });
    }

    report({ status: 'advancing', step, message: `Continuing to step ${step + 1}…` });

    /*
     * Tell a real advance from a click the page silently rejected. The step's
     * own field set is the signature: it changes when the form does, and
     * unlike an innerHTML length it does not flicker on every re-render.
     */
    const before = signature(scope);
    next.click();

    const advanced = await waitFor(() => {
      const now = flow.scope();
      if (!now) return null;
      return signature(now) !== before ? now : null;
    }, ADVANCE_TIMEOUT_MS);

    if (!advanced) {
      return report({
        status: 'blocked',
        step,
        filled: totalFilled,
        message: 'The form did not move on — something on this step needs your attention.',
      });
    }
  }

  return report({
    status: 'error',
    step: MAX_STEPS,
    filled: totalFilled,
    message: 'Gave up after too many steps — finish this one by hand.',
  });
}

/** Which controls this step is showing, as a comparable string. */
function signature(scope: ParentNode): string {
  return [...scope.querySelectorAll('input, select, textarea')]
    .map((control) => control.getAttribute('name') ?? control.getAttribute('id') ?? control.tagName)
    .join('|');
}
