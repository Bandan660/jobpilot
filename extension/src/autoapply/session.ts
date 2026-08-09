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
        report({
          state: 'running',
          stage: p.status === 'submitting' ? 'submit' : p.status === 'filling' ? 'fill' : 'check',
          message: p.message,
          questions: [],
          answersToSave: [],
        });
      },
      /*
       * Snapshot the hand-filled answers immediately before the click. This is
       * the last moment the form exists — after a successful submit LinkedIn
       * replaces the whole dialog.
       */
      beforeSubmit: (scope) => {
        capturedAnswers = readAnswers(scope, pendingQuestions);
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

    if (outcome.status === 'blocked' && outcome.blockers?.length) {
      /*
       * Remembered, not discarded. These are exactly the questions the user is
       * about to answer by hand, and knowing which they were is what lets us
       * offer to save them afterwards.
       */
      pendingQuestions = outcome.blockers.map((b) => b.label);

      return finish({
        state: 'needs-input',
        stage: 'check',
        message:
          outcome.blockers.length === 1
            ? 'One question needs you. Answer it in the form, then continue.'
            : `${outcome.blockers.length} questions need you. Answer them in the form, then continue.`,
        questions: outcome.blockers,
        answersToSave: [],
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

/** Set by the beforeSubmit hook, read once the submit is confirmed. */
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
