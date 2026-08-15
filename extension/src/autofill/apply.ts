import type { Profile } from '@jobpilot/shared';
import { autofill, fillComboboxes } from './index.js';
import { findBlockers, labelFor, type Blocker } from './blockers.js';
import { attachResume, findResumeInput, type StoredResume } from './resume.js';
import { fillControl, highlight } from './fill.js';
import { send } from '../messages.js';
import { visible } from '../dialogs.js';

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
 * With `autoSubmit` on, `autoapply/session.ts` sends the application itself.
 * That was a deliberate product decision, taken with the Web Store and
 * LinkedIn rate-limiting risks understood — see the note in CLAUDE.md before
 * changing it back.
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
  /**
   * Paused on a question the profile cannot answer, with the form still open
   * and the run still alive.
   *
   * Distinct from `blocked`, which is terminal. This one resolves itself: the
   * loop keeps ticking, sees the answer appear, and carries on.
   */
  | 'waiting'
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
  /**
   * What the step looked like when the run could not explain itself.
   *
   * Rendered in the panel rather than only logged, so a screenshot carries the
   * whole diagnosis. That is not a debugging nicety: every stall this session
   * has been diagnosed from a photograph, and the console has been the thing
   * nobody had open at the time.
   */
  diagnostic?: string[];
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
   * sending without a second press is what the product is for, but the shape
   * of the code keeps the old guarantee available: one flag, one call site,
   * one place to look when asking "can this send an application without me".
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
   * Called with a step still on screen, immediately before it is left behind.
   *
   * Fires before every advance and before the submit, and the caller is
   * expected to merge rather than replace — because a paginated flow destroys
   * each step's fields when it moves off them, not only at the end.
   *
   * This used to run before the submit alone, on the reasoning that a
   * successful submit replaces the whole dialog and so that is the last moment
   * the form exists. True for a single-page form, wrong for LinkedIn: the
   * final step is a review screen with no fields in it at all, so by the time
   * the submit fired there was nothing left to read and every hand-typed
   * answer was collected as an empty list. The loop that offers those answers
   * back to the profile — the only thing that makes the blocked list shorter
   * over time — quietly stopped working.
   *
   * Before the submit it runs after the blocker check, so it never reads a
   * form that is about to be refused.
   */
  snapshotAnswers?: (scope: ParentNode) => void;
}

const MAX_STEPS = 12;
const SETTLE_MS = 250;
/** How often the loop looks at the form again. */
const TICK_MS = 500;
/**
 * How long the run may sit with nothing happening before giving up.
 *
 * An idle timeout, not a whole-run ceiling, because the run now includes
 * waiting for the user to answer a question by hand — and a person reading a
 * question, thinking, and typing takes as long as it takes. Anything that
 * counts as progress resets it: a step changing, a question being answered, an
 * action being taken.
 *
 * It is safe to be this generous because nothing else relies on it to end.
 * A form that will not advance is bounded by `MAX_ADVANCE_ATTEMPTS`, and a
 * submit the page ignores by `SUBMIT_TIMEOUT_MS`. This only governs the case
 * where the run is legitimately waiting on a human.
 */
const IDLE_TIMEOUT_MS = 10 * 60_000;
/** Presses of the same continue button before the form is declared stuck. */
const MAX_ADVANCE_ATTEMPTS = 3;
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
 * Dispatch the full user event interaction sequence on an element.
 *
 * Modern component frameworks (like LinkedIn's Artdeco) listen to pointer and
 * mouse events in addition to click. Calling `el.click()` alone bypasses
 * `pointerdown`/`mousedown` event listeners, which leaves form step transition
 * state uncommitted.
 */
export function clickElement(el: HTMLElement): void {
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, view: window }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, detail: 1, view: window }));
  el.click();
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
  snapshotAnswers,
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
  let step = 0;

  /*
   * A tick loop, not a click-and-verify sequence.
   *
   * WHY THIS SHAPE
   *
   * The version this replaced did: click advance, watch for six seconds, and
   * if nothing observable changed, declare the form broken and stop. Every
   * stall reported against this driver came out of that one decision, because
   * it treats a single observation as proof and has no way back from a wrong
   * one. A click that landed but rendered slowly, a step whose fields the
   * platform keeps mounted, a button that needed pressing twice — all of them
   * are indistinguishable from a genuine refusal, and all of them ended the
   * run on a complete, correct, one-click-from-sent application.
   *
   * So the driver no longer decides whether its click worked. It looks at
   * whatever is on screen and does what that calls for: fill what is empty,
   * answer what it can, press the thing that moves it along. If the form
   * advanced, the next pass sees a new step and fills it. If it did not, the
   * next pass sees the same step and tries again. Recovery is the normal path
   * rather than an error branch, which is what makes it stop being fragile.
   *
   * WHAT STILL STOPS IT
   *
   * A bounded number of attempts at the same step, and an overall time budget.
   * Both end in a report that names what is on the step rather than a shrug.
   *
   * WHAT DOES NOT CHANGE
   *
   * Every guardrail around sending. `autoSubmit` is still off unless a caller
   * says otherwise, `findBlockers` still runs immediately before the click and
   * not once at the start, cancellation is still checked in the same breath as
   * the click, and the submission is still confirmed by the page rather than
   * by the click having happened. Submit is pressed at most once per run —
   * `submitClicked` latches, and after it the loop only ever watches.
   */
  let seen = '';
  /** The step number the combobox pass last ran on. See its call site. */
  let combosDoneForStep = -1;
  let advanceAttempts = 0;
  let submitClicked = false;
  let ticksSinceSubmit = 0;

  /** Field values as of the last refusal to advance, and whether it was said. */
  let heldValues = '';
  let heldAnnounced = false;

  /** The last set of questions reported, so waiting is not announced 120×/min. */
  let announced = '';
  /** Anything that counts as the run getting somewhere. */
  let lastActivity = Date.now();
  const active = () => {
    lastActivity = Date.now();
  };

  const sent = (): ApplyProgress =>
    report({
      status: 'submitted',
      step,
      filled: totalFilled,
      message: `Sent — ${totalFilled} field${totalFilled === 1 ? '' : 's'} filled${
        resumeAttached ? ', resume attached' : ''
      }.`,
    });

  while (Date.now() - lastActivity < IDLE_TIMEOUT_MS) {
    if (isCancelled()) return report({ status: 'cancelled', step, message: 'Stopped.' });

    const now = flow.scope();

    if (!now) {
      // The dialog is gone. After a submit that is the usual success signal;
      // before one it means the user closed it or the page moved on.
      if (submitClicked) return sent();
      return report({ status: 'error', step, message: 'The application form went away.' });
    }

    /* ------------------------- has anything moved? ------------------------ */

    const signatureNow = stepSignature(now);

    if (signatureNow !== seen) {
      /*
       * Say what moved, not just that something did.
       *
       * A run that counts steps it never took ends at `MAX_STEPS` with "gave
       * up after too many steps", and that message names neither the step nor
       * the change that produced it — so the report is a screenshot of a shrug
       * and the next move is guesswork. Reported once from Greenhouse and not
       * reproducible from the outside, which is exactly the case this exists
       * for: the difference is printed the moment it happens, on the machine
       * where it happens.
       *
       * Only the difference, and only when there was a previous signature:
       * printing both in full is 600 characters a tick and nobody reads it.
       */
      if (seen) trace(`step ${step} -> ${step + 1}:`, signatureDiff(seen, signatureNow));

      step += 1;
      advanceAttempts = 0;
      // A real step change retires the hold: the fields it was watching are
      // gone, so their values mean nothing on the step that replaced them.
      heldValues = '';
      heldAnnounced = false;
      active();

      // A step that changed after the submit, with the submit button gone, is
      // the page accepting it.
      if (submitClicked && findButton(now, flow.submit) === null) return sent();

      if (step > MAX_STEPS) {
        return report({
          status: 'error',
          step,
          filled: totalFilled,
          message: 'Gave up after too many steps — finish this one by hand.',
        });
      }

      /* ------------------------------ fill ------------------------------ */

      report({
        status: 'filling',
        step,
        message: `Filling${flow.multiStep ? ` step ${step}` : ''}…`,
      });

      /*
       * Anything said about waiting is now off the screen.
       *
       * The blocker report below is suppressed while its set is unchanged —
       * rightly, or the panel would repaint the same three questions twice a
       * second. But a step change re-enters the fill above and reports
       * "Filling…", and the questions then never came back: the fingerprint
       * had not changed, so the announcement was skipped, and the panel sat on
       * "Filling…" over a form that was actually waiting for the user.
       *
       * Seen on Greenhouse, where attaching the resume adds a Remove button
       * and so counts as a step. Clearing the record here means the next pass
       * says what it is waiting for, and the suppression still holds for the
       * ticks that follow it.
       */
      announced = '';

      const filled = autofill(profile, { root: now, showHighlights: true });
      totalFilled += filled.filled;
      trace(`filled ${filled.filled}, skipped ${filled.skipped}`);

      /*
       * Typeaheads in a second pass, because answering one means waiting for
       * the widget to fetch its options and then clicking one. Anything it
       * cannot answer is left empty deliberately, to be reported as a question
       * rather than carried into a submit as uncommitted text.
       */
      /*
       * Once per step, not once per tick.
       *
       * `autofill` above is cheap and idempotent — it never overwrites, so
       * re-running it costs a scan. The combobox pass is neither: it focuses
       * each widget and waits up to two and a half seconds for a list. A
       * dropdown it could not answer on this step it cannot answer on the next
       * tick either, so retrying is pure churn — and churn with a side effect,
       * because opening widgets is what made the step signature move and the
       * run count phantom steps until it gave up.
       *
       * Keyed to the step number rather than to `seen`, which at this point in
       * the pass still holds the *previous* step's signature — gating on that
       * would skip the first, and only, run on every new step.
       */
      if (combosDoneForStep !== step) {
        combosDoneForStep = step;

        const combos = await fillComboboxes(profile, { root: now, showHighlights: true });
        totalFilled += combos.filled;
        if (combos.filled || combos.failed.length) {
          trace(`comboboxes: ${combos.filled} answered, ${combos.failed.length} left for you`);
        }
      }

      /* ----------------------------- resume ----------------------------- */

      if (!resumeAttached && findResumeInput(now)) {
        report({ status: 'attaching', step, message: 'Attaching your resume…' });

        const stored = await send<StoredResume | null>({ type: 'GET_RESUME' });
        if (!stored.ok) {
          trace('resume unavailable:', stored.error);
        } else if (!stored.data) {
          trace('no resume on file');
        } else {
          const outcome = attachResume(stored.data, { scope: now });
          trace('resume:', outcome.status);
          // 'already-attached' counts: the field is satisfied either way, and
          // retrying it on every later step would be noise.
          resumeAttached = outcome.status === 'attached' || outcome.status === 'already-attached';
        }
      }

      /* ----------------------------- drafts ----------------------------- */

      if (draftAnswers && job && drafted < MAX_DRAFTS) {
        for (const question of openQuestions(now)) {
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
            break; // Rate limited or unconfigured: the next will fail too.
          }

          // An empty answer is the model declining to invent one. Leave the
          // box blank — that is the honest outcome and the user can see it.
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

      /*
       * Re-read after filling, so the fill's own effects are not mistaken for
       * the form advancing on the next pass. Filling can reveal a conditional
       * question or enable a button, both of which move the signature.
       */
      await sleep(SETTLE_MS);
      seen = stepSignature(flow.scope() ?? now);
      continue;
    }

    /* --------------------- the step is where we left it ------------------- */

    if (submitClicked) {
      // Confirmed by the page, not by the click. A click the form rejected
      // leaves the button exactly where it was, and counting that as sent is
      // how a run reports fifty applications and delivers none.
      if (findButton(now, flow.submit) === null) return sent();

      ticksSinceSubmit += 1;
      if (ticksSinceSubmit * TICK_MS >= SUBMIT_TIMEOUT_MS) {
        return report({
          status: 'blocked',
          step,
          filled: totalFilled,
          diagnostic: describeStep(now),
          message: 'Pressed submit but the form did not accept it.',
        });
      }

      await sleep(TICK_MS);
      continue;
    }

    /* ------------------------- waiting on the user ------------------------ */

    /*
     * A question the profile cannot answer pauses the run. It does not end it.
     *
     * This is the refactor's whole point. Ending here meant the *caller* had
     * to notice, start a second poll over the same form, wait for the answers,
     * and then start a fresh run — two loops watching one form, neither aware
     * of the other. Every failure mode that arrangement produced was real: a
     * run that ended in `error` for any other reason stopped the watcher too,
     * so answering the question afterwards did nothing; a cap had to be
     * invented to stop the two loops ping-ponging; and `blocked` had to mean
     * both "needs you" and "I give up", which is why a recoverable pause kept
     * being reported as a dead end.
     *
     * Now the loop simply keeps ticking. It re-reads the blockers every pass,
     * and the moment they clear it carries on to the submit or the next step —
     * no restart, no re-fill from the top, no second watcher, and nothing to
     * press.
     */
    const blockers = findBlockers(now);

    if (blockers.length > 0) {
      const fingerprint = blockers.map((b) => `${b.kind}:${b.label}`).join('|');

      // Announced only when the set changes: answering one of three questions
      // is progress worth reporting, 500ms passing is not.
      if (fingerprint !== announced) {
        announced = fingerprint;
        active();
        trace('waiting on:', blockers.map((b) => b.label));

        report({
          status: 'waiting',
          step,
          filled: totalFilled,
          blockers,
          message: `${blockers.length} thing${blockers.length === 1 ? '' : 's'} still need${
            blockers.length === 1 ? 's' : ''
          } you.`,
        });
      }

      await sleep(TICK_MS);
      continue;
    }

    // Cleared. Anything announced earlier is answered, and the next pass
    // through this point is a fresh question rather than the same one.
    if (announced) {
      announced = '';
      active();
      trace('questions answered — carrying on');
    }

    /* ------------------------------- finish ------------------------------- */

    const submitButton = findButton(now, flow.submit);

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

      // Cancellation in the same breath as the click. Stop must stop,
      // including in the last hundred milliseconds. The blocker check above
      // ran on this same pass, against this same DOM.
      if (isCancelled()) return report({ status: 'cancelled', step, message: 'Stopped.' });

      snapshotAnswers?.(now);
      report({ status: 'submitting', step, message: 'Sending the application…' });

      clickElement(submitButton);
      submitClicked = true;
      ticksSinceSubmit = 0;

      await sleep(TICK_MS);
      continue;
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

    /* ------------------------------ advance ------------------------------ */

    const next = findButton(now, flow.advance);

    if (!next) {
      trace('no advance button on a step with nothing blocking it');
      return report({
        status: 'blocked',
        step,
        filled: totalFilled,
        diagnostic: describeStep(now),
        message: 'Could not find the button to continue. Here is everything on this step:',
      });
    }

    /*
     * The form will not move and nothing on it says why.
     *
     * This used to end the run. It was the wrong shape for the commonest
     * cause: an answer the page rejects. The user types something the form
     * dislikes, the step refuses, the cap is reached, and the run is over —
     * so correcting the field afterwards achieves nothing, because there is
     * no longer anything watching it. That is the same dead end the blocker
     * refactor removed everywhere else, left behind in the one branch that
     * reaches it when `findBlockers` cannot name the problem.
     *
     * So it holds instead of ending: stop pressing a button that is not
     * working, say so, and keep watching. `advanceAttempts` cannot reset off
     * `stepSignature` here — that ignores values by design, and a corrected
     * field changes nothing else — so the retry is keyed to the values
     * themselves. Touch the form and it tries again; leave it alone and it
     * sits quietly rather than hammering a form that has already said no.
     *
     * The outer idle timeout is still the backstop. Ten minutes of no edits
     * and no movement ends the run the way it always did.
     */
    if (advanceAttempts >= MAX_ADVANCE_ATTEMPTS) {
      const values = valueSignature(now);

      if (values !== heldValues) {
        // Either the hold has just started, or the user has changed something
        // since it did. Both are worth another press.
        heldValues = values;
        advanceAttempts = 0;
        heldAnnounced = false;
        active();
      } else {
        if (!heldAnnounced) {
          heldAnnounced = true;
          trace('form refused to advance; holding for a correction', describeStep(now));

          report({
            status: 'waiting',
            step,
            filled: totalFilled,
            blockers: [{ label: 'This step will not continue — check the fields for an error', kind: 'invalid' }],
            diagnostic: describeStep(now),
            message:
              'The form would not move on and did not say why. Check this step for a field it is rejecting — correcting it picks the run back up.',
          });
        }

        await sleep(TICK_MS);
        continue;
      }
    }

    advanceAttempts += 1;
    active();
    report({
      status: 'advancing',
      step,
      message:
        advanceAttempts === 1
          ? `Continuing to step ${step + 1}…`
          : `Still on step ${step} — trying again (${advanceAttempts} of ${MAX_ADVANCE_ATTEMPTS})…`,
    });

    // Last look at this step's fields. Advancing destroys them, and on a flow
    // that ends in a fieldless review screen this is the only chance to read
    // what the user typed by hand.
    snapshotAnswers?.(now);
    clickElement(next);

    await sleep(TICK_MS);
  }

  return report({
    status: 'error',
    step,
    filled: totalFilled,
    message: 'Nothing happened on this form for ten minutes — finish this one by hand.',
  });
}

/**
 * Everything about a step that could explain a refusal, in one console dump.
 *
 * Printed only when the form declined to advance and `findBlockers` came back
 * empty — the state where the run genuinely cannot say what is wrong, and the
 * one that has repeatedly turned into a round of guesswork. Whatever LinkedIn
 * is objecting to is on screen at this moment; this makes it readable without
 * asking anyone to go spelunking in devtools.
 */
function describeStep(scope: ParentNode): string[] {
  const lines: string[] = [];

  /*
   * What the container itself is, first.
   *
   * The single most useful fact when a run stalls, and the one nothing was
   * reporting. Whether Easy Apply is a `<dialog>`, whether it is `:modal`, and
   * what hooks it carries decides which selectors can see it at all — and
   * every wrong guess this session came from not knowing.
   */
  const host = scope instanceof Element ? scope : null;
  if (host) {
    const attrs = ['role', 'aria-modal', 'data-test-modal', 'aria-labelledby']
      .map((name) => (host.hasAttribute(name) ? `${name}=${host.getAttribute(name)}` : ''))
      .filter(Boolean)
      .join(' ');

    let modal = '?';
    try {
      modal = host.matches(':modal') ? 'top-layer' : 'in-page';
    } catch {
      /* :modal is not understood here; the label stays unknown. */
    }

    lines.push(`<${host.tagName.toLowerCase()}> ${modal} ${attrs}`.trim());
    lines.push(`class=${(host.className || '(none)').toString().slice(0, 90)}`);
  }

  for (const el of scope.querySelectorAll<HTMLElement>('input, select, textarea')) {
    const control = el as HTMLInputElement;
    const type = control.type || el.tagName.toLowerCase();
    if (type === 'hidden') continue;

    const required =
      type === 'radio' ||
      control.required ||
      el.getAttribute('aria-required') === 'true' ||
      el.closest('[aria-required="true"]') !== null;

    const state =
      type === 'file'
        ? `${control.files?.length ?? 0} file`
        : type === 'radio' || type === 'checkbox'
          ? control.checked
            ? 'checked'
            : 'unchecked'
          : control.value
            ? `"${control.value.slice(0, 18)}"`
            : 'EMPTY';

    const flags = [
      required ? 'req' : '',
      visible(el) ? '' : 'hidden',
      el.getAttribute('role') === 'combobox' ? 'combo' : '',
      el.getAttribute('aria-invalid') === 'true' ? 'INVALID' : '',
    ].filter(Boolean);

    lines.push(
      `${labelFor(el, scope).slice(0, 26)} · ${type} · ${state}${
        flags.length ? ` · ${flags.join(',')}` : ''
      }`
    );
  }

  const complaints = [
    ...scope.querySelectorAll<HTMLElement>(
      '[class*="error" i], [class*="invalid" i], [role="alert"], [aria-live]'
    ),
  ]
    .filter((el) => visible(el))
    .map((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((text) => text && text.length < 160);

  for (const text of [...new Set(complaints)]) lines.push(`! ${text}`);

  for (const b of scope.querySelectorAll<HTMLButtonElement>('button, [role="button"]')) {
    if (!visible(b)) continue;
    const text = (b.textContent || '').replace(/\s+/g, ' ').trim() || b.getAttribute('aria-label');
    if (text) lines.push(`[${text.slice(0, 28)}]${b.disabled ? ' disabled' : ''}`);
  }

  trace('step could not advance, nothing reported as blocking:', lines);
  return lines;
}

/**
 * What step this is, as a comparable string.
 *
 * Three parts, because the field list alone was not enough to tell an advance
 * from a click the page ignored.
 *
 * **Only visible controls.** A paginated form is entitled to keep every step
 * mounted and hide the ones it is not showing, and several do. Counting hidden
 * fields makes every step look identical, so a perfectly good advance reads as
 * a refusal.
 *
 * **The buttons.** The last question step and the review screen differ mostly
 * in that one says Review and the other says Submit application — and the
 * review screen has no fields at all, so without this the two are only
 * distinguishable by an empty field list, which is also what a dialog closing
 * looks like.
 *
 * **The heading.** "Additional Questions" to "Review your application" is the
 * clearest signal of the three and costs one `querySelector`.
 *
 * This was found on a live run that filled every field, clicked Review, and
 * reported "the form did not move on" — with the panel's own dump showing a
 * complete step and a live `[Review]` button.
 */
/**
 * Chrome that belongs to an *open widget*, not to the step.
 *
 * A dropdown that is open renders a list, and often a search box and a row of
 * clickable items with it. None of that is the form moving on — it is a
 * control being interacted with, and it disappears again the moment focus
 * leaves. Greenhouse made the difference expensive: the combobox pass opens
 * seventeen widgets in turn, so the signature changed on almost every tick,
 * every change counted as a new step, and the run hit `MAX_STEPS` and gave up
 * on a form it had merely been filling.
 */
const WIDGET_CHROME = '[role="listbox"], [role="menu"], [role="option"], [class*="menu"]';

/**
 * What actually differs between two step signatures, in a line.
 *
 * Signatures are pipe-joined field names and button labels, so the useful
 * answer is which entries appeared and which vanished — not the two strings.
 */
function signatureDiff(before: string, after: string): string {
  const parts = (value: string) => new Set(value.split(/[#|]/).filter(Boolean));
  const from = parts(before);
  const to = parts(after);

  const gone = [...from].filter((item) => !to.has(item));
  const added = [...to].filter((item) => !from.has(item));

  if (!gone.length && !added.length) return 'nothing named changed (heading or ordering)';

  const show = (items: string[]) => items.slice(0, 6).join(', ') + (items.length > 6 ? ` +${items.length - 6}` : '');
  return [added.length ? `+ ${show(added)}` : '', gone.length ? `- ${show(gone)}` : '']
    .filter(Boolean)
    .join('  ');
}

/** Present-or-not, in a stable order. Empty entries carry nothing and go. */
function unique(values: string[]): string {
  return [...new Set(values.filter(Boolean))].sort().join('|');
}

function stepSignature(scope: ParentNode): string {
  const stable = (el: HTMLElement) => visible(el) && !el.closest(WIDGET_CHROME);

  const controls = unique(
    [...scope.querySelectorAll<HTMLElement>('input, select, textarea')]
      .filter(stable)
      .map((el) => el.getAttribute('name') ?? el.getAttribute('id') ?? el.tagName)
  );

  /*
   * A set, not a list: what is present, not how many or in what order.
   *
   * This is the phantom step, measured on a live Greenhouse form. Its buttons
   * read `|Locate me||Attach|Dropbox|…||||||||||||||Submit application` —
   * fifteen unlabelled icon controls, react-select's `Toggle flyout` arrows
   * and the file widget's remove. They come and go with *values* and with
   * focus rather than with steps, and every appearance shifted the joined
   * string. Attaching the resume alone was enough: the log read `step 1 -> 2:
   * nothing named changed`, and a single-page form that should run the loop
   * once climbed to `MAX_STEPS` and reported "gave up after too many steps".
   *
   * Naming them via `aria-label` was the wrong repair and made it worse —
   * fifteen identical `Toggle flyout` entries are still fifteen positions in a
   * joined string. Deduplicating removes the whole class: one flyout arrow or
   * sixteen reads the same, in any order, while a genuinely new control — a
   * `Next`, a `Submit application`, a field that only the second page has —
   * still moves it, which is the one thing this has to detect.
   */
  const buttons = unique(
    [...scope.querySelectorAll<HTMLElement>('button, [role="button"]')]
      .filter(stable)
      .map((el) =>
        ((el.textContent ?? '') || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 24)
      )
  );

  const heading = (scope.querySelector('h1, h2, h3')?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

  return `${heading}#${controls}#${buttons}`;
}

/**
 * What the step currently *contains*, as opposed to what it is made of.
 *
 * `stepSignature` deliberately ignores values — it answers "did the form move
 * to a different step", and a signature that changed every keystroke could not
 * do that. But it means editing a field is invisible to the loop, and the one
 * place that matters is the hold below: a run parked because the form refused
 * to advance has to notice the user fixing the field, and fixing a field
 * changes nothing else. Values are the only evidence there is.
 */
function valueSignature(scope: ParentNode): string {
  return [...scope.querySelectorAll<HTMLElement>('input, select, textarea')]
    .filter((el) => visible(el))
    .map((el) => {
      const control = el as HTMLInputElement;
      const type = control.type?.toLowerCase();
      if (type === 'checkbox' || type === 'radio') return control.checked ? '1' : '0';
      if (type === 'file') return String(control.files?.length ?? 0);
      return control.value ?? '';
    })
    .join('|');
}

