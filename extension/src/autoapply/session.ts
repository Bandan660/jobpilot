import type { CapturedJob, Profile } from '@jobpilot/shared';
import { runApply, type ApplyFlow } from '../autofill/apply.js';
import { findBlockers, labelFor, type Blocker } from '../autofill/blockers.js';

/**
 * One application, start to finish, with a pause in the middle when the form
 * asks something the profile cannot answer.
 *
 * WHY ONE AT A TIME
 *
 * A queue that works down a whole list applies to everything it can reach,
 * which is not what this is for. One click is one application: this posting,
 * the one on screen. Moving to the next job and pressing the button again is
 * the loop, and the person doing it sees each posting before it is sent.
 *
 * WHAT HAPPENS WHEN IT CANNOT ANSWER SOMETHING
 *
 * It stops and names the questions, and it leaves the form open. It does not
 * skip the job — skipping is what loses an application to a single dropdown.
 * The user answers the questions in LinkedIn's own form, presses continue, and
 * the session picks up exactly where it stopped: re-check, submit, record.
 *
 * Anything they had to answer by hand is offered back to the profile
 * afterwards, keyed by the question, so the same question fills itself next
 * time. That is the only way the blocked list gets shorter over time.
 */

export type SessionStage = 'fill' | 'check' | 'submit' | null;

export type SessionState =
  | 'idle'
  | 'running'
  /** Waiting for the user to answer something. The form is still open. */
  | 'needs-input'
  | 'done'
  | 'error';

export interface SessionProgress {
  state: SessionState;
  stage: SessionStage;
  message: string;
  /** Questions the user has to answer, when state is 'needs-input'. */
  questions: Blocker[];
  /** Offered after a submit that needed hand-filled answers. */
  answersToSave: { label: string; answer: string }[];
  /** What the step looked like, when the run could not say what was wrong. */
  diagnostic?: string[];
}

export interface SessionOptions {
  profile: Profile;
  flow: ApplyFlow;
  draftAnswers: boolean;
  onProgress: (progress: SessionProgress) => void;
  onApplied: (job: CapturedJob) => Promise<boolean>;
  readCurrentJob: () => CapturedJob | null;
}

function trace(...args: unknown[]): void {
  console.info('[jobpilot] session:', ...args);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Questions this session has already asked the user to answer by hand.
 *
 * Kept across the pause so that, once the application goes through, we know
 * which answers were the user's own and worth offering to save. Cleared when
 * the session ends or the posting changes.
 */
let pendingQuestions: string[] = [];
let active = false;
let cancelled = false;

export function sessionBusy(): boolean {
  return active;
}

export function cancelSession(): void {
  cancelled = true;
}

export function resetSession(): void {
  pendingQuestions = [];
  // Accumulates across the resumes of one application, so it has to be cleared
  // when the posting changes — otherwise the next job is offered answers typed
  // into the last one.
  capturedAnswers = [];
  active = false;
  cancelled = false;
}

/**
 * Read what is currently in the controls behind a set of question labels.
 *
 * Taken before submitting, because the form is gone afterwards. Matching by
 * label rather than by holding element references: the modal re-renders
 * between steps, so anything captured earlier points at a detached node.
 */
function readAnswers(scope: ParentNode, labels: string[]): { label: string; answer: string }[] {
  if (labels.length === 0) return [];

  const wanted = new Set(labels);
  const found: { label: string; answer: string }[] = [];

  const controls = scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input, select, textarea'
  );

  for (const control of controls) {
    const type = (control as HTMLInputElement).type;
    if (type === 'hidden' || type === 'file' || type === 'password') continue;

    const label = labelFor(control, scope);
    if (!wanted.has(label)) continue;

    let answer: string;
    if (type === 'radio' || type === 'checkbox') {
      const input = control as HTMLInputElement;
      if (!input.checked) continue;
      // The option's own text is the answer; the group's question is the label.
      answer = labelOfOption(input) || input.value;
    } else {
      answer = String(control.value ?? '').trim();
    }

    if (!answer) continue;
    if (found.some((entry) => entry.label === label)) continue;
    found.push({ label, answer });
  }

  return found;
}

function labelOfOption(input: HTMLInputElement): string {
  const own =
    input.closest('label')?.textContent ??
    (input.id ? input.ownerDocument.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : null);
  return (own ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Run, or resume after the user has filled the gaps.
 *
 * Resuming is the same call. `runApply` never overwrites a filled field, so a
 * second pass re-fills only what is still empty, re-checks, and submits.
 */
export async function runSession(options: SessionOptions): Promise<SessionProgress> {
  active = true;
  cancelled = false;

  const report = (progress: SessionProgress): SessionProgress => {
    trace(progress.state, progress.stage ?? '-', progress.message);
    options.onProgress(progress);
    return progress;
  };

  const finish = (progress: SessionProgress): SessionProgress => {
    active = false;
    return report(progress);
  };

  try {
    const outcome = await runApply({
      profile: options.profile,
      flow: options.flow,
      draftAnswers: options.draftAnswers,
      autoSubmit: true,
      isCancelled: () => cancelled,
      job: (() => {
        const job = options.readCurrentJob();
        return job ? { title: job.title, company: job.company, jobUrl: job.jobUrl } : undefined;
      })(),
      onProgress: (p) => {
        /*
         * `waiting` is a pause inside a live run, not the end of one.
         *
         * The panel shows it exactly as it always showed needs-input — the
         * questions named, the form left open — but nothing here has to
         * arrange the resumption. The driver is still ticking and picks it up
         * itself the moment the answers appear.
         */
        if (p.status === 'waiting') {
          // Remembered so the answers can be offered back to the profile once
          // the application goes through.
          pendingQuestions = (p.blockers ?? []).map((b) => b.label);

          report({
            state: 'needs-input',
            stage: 'check',
            message: p.message,
            questions: p.blockers ?? [],
            diagnostic: (p.blockers ?? []).map((b) => b.label),
            answersToSave: [],
          });
          return;
        }

        report({
          state: 'running',
          stage: p.status === 'submitting' ? 'submit' : p.status === 'filling' ? 'fill' : 'check',
          message: p.message,
          questions: [],
          answersToSave: [],
        });
      },
      /*
       * Snapshot the hand-filled answers as each step is left behind.
       *
       * Merged, never replaced: the questions the user answered are spread
       * across the steps, and each step's fields are gone once the form moves
       * off it. Reading only at submit-time collected nothing at all on
       * LinkedIn, whose last step is a review screen with no fields in it.
       */
      snapshotAnswers: (scope) => {
        for (const answer of readAnswers(scope, pendingQuestions)) {
          if (capturedAnswers.some((seen) => seen.label === answer.label)) continue;
          capturedAnswers.push(answer);
        }
      },
    });

    if (outcome.status === 'submitted') {
      const job = options.readCurrentJob();
      let recorded = true;
      if (job) recorded = await options.onApplied(job);

      const answers = capturedAnswers;
      capturedAnswers = [];
      pendingQuestions = [];

      return finish({
        state: 'done',
        stage: null,
        message: recorded
          ? 'Applied — added to your tracker.'
          : 'Applied, but it could not be added to your tracker.',
        questions: [],
        answersToSave: answers,
      });
    }

    /*
     * `blocked` is terminal now, and only means the driver is genuinely stuck
     * — a form that would not advance after several presses, or a submit the
     * page ignored. A question the user has to answer no longer arrives here:
     * it is reported as `waiting` while the run stays alive, and resolves
     * without anything in this file being involved.
     *
     * The distinction matters because these need opposite treatment. A pause
     * should keep the form open and say what to type; a dead end should stop
     * and show what it could see. Conflating them is why answering a question
     * sometimes did nothing at all — the run had already ended.
     */
    if (outcome.status === 'blocked') {
      return finish({
        state: 'error',
        stage: null,
        message: outcome.message,
        questions: outcome.blockers ?? [],
        answersToSave: [],
        diagnostic: outcome.diagnostic,
      });
    }

    if (outcome.status === 'cancelled') {
      return finish({ state: 'idle', stage: null, message: 'Stopped.', questions: [], answersToSave: [] });
    }

    return finish({
      state: 'error',
      stage: null,
      message: outcome.message,
      questions: [],
      answersToSave: [],
      // Survives to the panel so a screenshot carries the diagnosis.
      diagnostic: outcome.diagnostic,
    });
  } catch (error) {
    return finish({
      state: 'error',
      stage: null,
      message: error instanceof Error ? error.message : 'Something went wrong.',
      questions: [],
      answersToSave: [],
    });
  }
}

/** Accumulated by the snapshotAnswers hook, read once the submit is confirmed. */
let capturedAnswers: { label: string; answer: string }[] = [];

/**
 * Are the named questions answered now?
 *
 * Used by the panel to enable "continue" only once there is something to
 * continue with, rather than letting the user press it and get the same list
 * of questions straight back.
 */
export function questionsOutstanding(scope: ParentNode): Blocker[] {
  return findBlockers(scope);
}

export { sleep };
