import type { Profile } from '@jobpilot/shared';
import { autofill } from './index.js';

/**
 * Drives LinkedIn's Easy Apply flow: opens it, fills each step, advances, and
 * stops at the review step.
 *
 * WHERE IT STOPS, AND WHY
 *
 * It never clicks Submit. The final press stays a human decision, which is the
 * line between an assistant and a tool for spraying applications at everything
 * — and it is the same rule the rest of the autofill code follows. Everything
 * up to that point is typing the user would otherwise do by hand.
 *
 * It also stops rather than guessing. If a step has a required question the
 * profile cannot answer, the run halts there and says which one; LinkedIn
 * refuses to advance past required fields anyway, so pressing on would produce
 * a silent stall with no explanation.
 *
 * FRAGILITY
 *
 * Every selector here is LinkedIn's, and LinkedIn ships hashed class names. The
 * buttons are found by aria-label first and visible text second, because those
 * are the two things that survive a redesign. Expect maintenance.
 */

export type AutoApplyStatus =
  | 'opening'
  | 'filling'
  | 'advancing'
  | 'blocked'
  | 'ready'
  | 'cancelled'
  | 'error';

export interface AutoApplyProgress {
  status: AutoApplyStatus;
  step: number;
  message: string;
  /** Labels of required questions the profile could not answer. */
  blockers?: string[];
  filled?: number;
}

/** Guards against a mis-detected step loop; real flows are 3-6 steps. */
const MAX_STEPS = 12;
const SETTLE_MS = 220;
const WAIT_TIMEOUT_MS = 8000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => T | null, timeoutMs = WAIT_TIMEOUT_MS): Promise<T | null> {
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

/** Finds a button by aria-label, then by its visible text. */
function findButton(root: ParentNode, patterns: RegExp[]): HTMLButtonElement | null {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => !b.disabled && visible(b)
  );

  for (const pattern of patterns) {
    const byLabel = buttons.find((b) => pattern.test(b.getAttribute('aria-label') ?? ''));
    if (byLabel) return byLabel;

    const byText = buttons.find((b) => pattern.test(b.textContent?.trim() ?? ''));
    if (byText) return byText;
  }
  return null;
}

export function findModal(): HTMLElement | null {
  const dialog =
    document.querySelector<HTMLElement>('.jobs-easy-apply-modal') ??
    document.querySelector<HTMLElement>('div[role="dialog"]');
  return dialog && dialog.querySelector('input, select, textarea') ? dialog : null;
}

/** The Easy Apply entry point on the posting itself. */
function findEasyApplyTrigger(): HTMLButtonElement | null {
  const scope = document.querySelector('.jobs-search__job-details') ?? document;
  return findButton(scope, [/easy apply/i]);
}

const SUBMIT = [/^submit application$/i, /^submit$/i];
const ADVANCE = [/continue to next step/i, /review your application/i, /^next$/i, /^review$/i, /^continue$/i];

/**
 * Required fields the user still has to deal with.
 *
 * Two sources: controls LinkedIn marks required that are still empty, and
 * validation errors it has already rendered. The second catches formats we
 * filled wrongly, which an emptiness check alone would miss.
 */
function findBlockers(modal: HTMLElement): string[] {
  const blockers: string[] = [];

  const controls = modal.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input[required], select[required], textarea[required], [aria-required="true"]'
  );

  for (const control of controls) {
    if (control.type === 'hidden' || control.disabled || !visible(control)) continue;

    const isRadioOrCheck = control.type === 'radio' || control.type === 'checkbox';
    const group = isRadioOrCheck
      ? modal.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(control.name)}"]`)
      : null;

    const empty = group
      ? ![...group].some((input) => input.checked)
      : !String((control as HTMLInputElement).value ?? '').trim();

    if (!empty) continue;

    const label = labelFor(control, modal);
    if (label && !blockers.includes(label)) blockers.push(label);
  }

  for (const error of modal.querySelectorAll('.artdeco-inline-feedback--error')) {
    const text = error.textContent?.trim();
    if (text && !blockers.includes(text)) blockers.push(text);
  }

  return blockers.slice(0, 6);
}

function labelFor(control: Element, modal: HTMLElement): string {
  const id = control.getAttribute('id');
  if (id) {
    const label = modal.querySelector(`label[for="${CSS.escape(id)}"]`);
    const text = label?.textContent?.trim();
    if (text) return text.slice(0, 120);
  }

  const wrapper = control.closest('[data-test-form-element], fieldset, .fb-dash-form-element');
  const legend = wrapper?.querySelector('legend, label, .fb-dash-form-element__label');
  return (legend?.textContent?.trim() ?? control.getAttribute('aria-label') ?? 'A required question').slice(
    0,
    120
  );
}

export interface AutoApplyOptions {
  profile: Profile;
  onProgress: (progress: AutoApplyProgress) => void;
  /** Checked between steps so the user can stop a run in flight. */
  isCancelled: () => boolean;
}

export async function runAutoApply({
  profile,
  onProgress,
  isCancelled,
}: AutoApplyOptions): Promise<AutoApplyProgress> {
  const report = (progress: AutoApplyProgress): AutoApplyProgress => {
    onProgress(progress);
    return progress;
  };

  let modal = findModal();

  if (!modal) {
    const trigger = findEasyApplyTrigger();
    if (!trigger) {
      return report({
        status: 'error',
        step: 0,
        message: 'No Easy Apply button here — this posting applies on the company site.',
      });
    }

    report({ status: 'opening', step: 0, message: 'Opening Easy Apply…' });
    trigger.click();

    modal = await waitFor(findModal);
    if (!modal) {
      return report({ status: 'error', step: 0, message: 'Easy Apply did not open.' });
    }
  }

  let totalFilled = 0;

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    if (isCancelled()) return report({ status: 'cancelled', step, message: 'Stopped.' });

    const current = findModal();
    if (!current) {
      return report({ status: 'error', step, message: 'The Easy Apply window closed.' });
    }
    modal = current;

    report({ status: 'filling', step, message: `Filling step ${step}…` });

    const result = autofill(profile, { root: modal, showHighlights: true });
    totalFilled += result.filled;

    // Let LinkedIn's own validation run against what we just typed before
    // deciding whether the step is complete.
    await sleep(SETTLE_MS);

    const blockers = findBlockers(modal);
    if (blockers.length > 0) {
      return report({
        status: 'blocked',
        step,
        filled: totalFilled,
        blockers,
        message: `Step ${step} needs you — ${blockers.length} question${
          blockers.length === 1 ? '' : 's'
        } your profile does not answer.`,
      });
    }

    /*
     * Submit present means this is the review step. Stop here: the run has
     * done the typing, and sending the application is the user's call.
     */
    if (findButton(modal, SUBMIT)) {
      return report({
        status: 'ready',
        step,
        filled: totalFilled,
        message: `Ready to send — ${totalFilled} field${
          totalFilled === 1 ? '' : 's'
        } filled. Review it, then submit.`,
      });
    }

    const next = findButton(modal, ADVANCE);
    if (!next) {
      return report({
        status: 'blocked',
        step,
        filled: totalFilled,
        message: 'Could not find the button to continue. Finish this step yourself.',
      });
    }

    report({ status: 'advancing', step, message: `Continuing to step ${step + 1}…` });

    // Signature of the current step, so we can tell a real advance from a
    // click that LinkedIn silently rejected.
    const before = modal.innerHTML.length;
    next.click();

    const advanced = await waitFor(() => {
      const now = findModal();
      if (!now) return null;
      return now.innerHTML.length !== before ? now : null;
    }, 6000);

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
