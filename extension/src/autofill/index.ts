import {
  DEMOGRAPHIC_FIELDS,
  answerKey,
  profileValue,
  type Profile,
  type ProfileField,
} from '@jobpilot/shared';
import { scanForm, type FieldMatch } from './match.js';
import {
  commitCombobox,
  fillControl,
  highlight,
  isCombobox,
  type FillOutcome,
} from './fill.js';

export { scanForm, matchControl } from './match.js';

export interface AutofillResult {
  filled: number;
  skipped: number;
  unmatched: number;
  /** Questions with no saved answer — what the user still has to write. */
  unanswered: { label: string }[];
  byField: Partial<Record<ProfileField, FillOutcome>>;
}

export interface AutofillOptions {
  /** Replace values already in the form. Off by default. */
  overwrite?: boolean;
  /** Visually mark what was changed. */
  showHighlights?: boolean;
  root?: ParentNode;
}

/**
 * Long free-text prompts are answered from saved answers rather than profile
 * fields. Below this length a textarea is more likely a short field than an
 * essay question.
 */
const OPEN_QUESTION_MIN_LABEL = 12;

function savedAnswerFor(profile: Profile, label: string): string | null {
  if (!label || label.length < OPEN_QUESTION_MIN_LABEL) return null;
  const key = answerKey(label);
  const hit = profile.savedAnswers.find((answer) => answer.key === key);
  return hit?.answer ?? null;
}

/**
 * Fill a job application form from the user's profile.
 *
 * Deliberately conservative: it never submits, never clears a field, never
 * overwrites the user's own typing by default, and skips anything matching the
 * blocked patterns. Autofill that silently gets something wrong is worse than
 * autofill that leaves a field blank, because the user has no reason to look.
 */
export function autofill(profile: Profile, options: AutofillOptions = {}): AutofillResult {
  const { overwrite = false, showHighlights = true, root } = options;

  const matches = scanForm(root);
  const result: AutofillResult = {
    filled: 0,
    skipped: 0,
    unmatched: 0,
    unanswered: [],
    byField: {},
  };

  for (const match of matches) {
    const value = resolveValue(profile, match);

    if (value === null) {
      // A textarea with a real question on it is something the user still has
      // to answer — surface it rather than counting it as noise.
      if (match.control instanceof HTMLTextAreaElement && match.label.length >= OPEN_QUESTION_MIN_LABEL) {
        result.unanswered.push({ label: match.label });
      }
      result.unmatched += 1;
      continue;
    }

    const outcome = fillControl(match.control, value, overwrite);
    if (match.field) result.byField[match.field] = outcome;

    if (outcome === 'filled') {
      result.filled += 1;
      if (showHighlights) highlight(match.control);
    } else if (outcome === 'skipped-filled') {
      result.skipped += 1;
    } else {
      result.unmatched += 1;
    }
  }

  return result;
}

/**
 * Second pass, for the fields that cannot be answered by writing text.
 *
 * Separate from `autofill` and asynchronous because committing a typeahead
 * means typing, waiting for the widget to fetch its options, and clicking one
 * — seconds, not microseconds. Keeping `autofill` synchronous keeps every
 * other caller, and the coverage preview, unchanged.
 *
 * Returns how many were answered. Anything it could not answer is left empty
 * on purpose, so `findBlockers` reports it as a question rather than the run
 * carrying an uncommitted value into a submit.
 */
/**
 * Anything the user could be typing into.
 *
 * The panel's own controls live in a closed shadow root, so `activeElement`
 * reports the host element for those — which is not a form control and
 * correctly does not count as the user typing in the page.
 */
function isPageControl(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLInputElement) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * How long the whole combobox pass may take.
 *
 * Each one waits up to `LISTBOX_TIMEOUT_MS` for its options to arrive, and a
 * modern Greenhouse form has seventeen comboboxes and no native selects at all
 * — country, location and every screening question. Unbounded, that is the
 * better part of a minute during which the page keeps taking focus. Whatever
 * is not answered inside the budget is reported as a question for the user,
 * which is what happens to an unanswerable one anyway.
 */
const COMBOBOX_PASS_BUDGET_MS = 12_000;

export async function fillComboboxes(
  profile: Profile,
  options: AutofillOptions = {}
): Promise<{ filled: number; failed: { label: string }[] }> {
  const { overwrite = false, showHighlights = true, root } = options;
  const result = { filled: 0, failed: [] as { label: string }[] };

  const deadline = Date.now() + COMBOBOX_PASS_BUDGET_MS;
  /** The control this pass focused last, so its own focus is not read as the user's. */
  let ours: Element | null = null;
  /**
   * Set once the user has taken over, and never cleared.
   *
   * Resuming when they happen to click away would be worse than not resuming:
   * the pass would start taking focus again exactly when they returned to the
   * form, which is the behaviour being fixed. One interruption ends it, and
   * what is left is reported rather than silently abandoned.
   */
  let interrupted = false;

  for (const match of scanForm(root)) {
    const control = match.control;
    if (!isCombobox(control)) continue;
    if (!(control instanceof HTMLInputElement)) continue;
    if (control.disabled || control.readOnly) continue;
    if (!overwrite && control.value.trim() !== '') continue;

    const value = resolveValue(profile, match);
    if (value === null) continue;

    /*
     * Stop the moment the user starts typing somewhere else.
     *
     * `commitCombobox` has to focus the control — a typeahead will not open
     * its listbox otherwise — and each one can hold that focus for two and a
     * half seconds. Across seventeen fields that is a form which yanks the
     * caret away every couple of seconds while someone is trying to answer it
     * by hand. Reported from Greenhouse, where it makes the form unusable.
     *
     * Skipping just this one would not help: the next iteration would take the
     * focus again a moment later. So the pass stops filling altogether, and
     * everything left goes into `failed`, which the panel already surfaces as
     * questions to answer.
     */
    const active = document.activeElement;
    if (active !== control && active !== ours && isPageControl(active)) interrupted = true;

    if (interrupted || Date.now() > deadline) {
      result.failed.push({ label: match.label });
      continue;
    }

    if (await commitCombobox(control, value)) {
      result.filled += 1;
      if (showHighlights) highlight(control);
    } else {
      result.failed.push({ label: match.label });
    }

    ours = control;
  }

  /*
   * Hand focus back. Leaving it in the last combobox this touched means the
   * user's next keystroke lands in a field they did not choose — and if that
   * field is a typeahead, in one that will reinterpret it.
   */
  if (ours && document.activeElement === ours) (ours as HTMLElement).blur();

  return result;
}

function resolveValue(profile: Profile, match: FieldMatch): string | null {
  if (match.field) {
    // The demographics group is opt-in; profileValue already returns null when
    // it is off, but checking here keeps the intent obvious at the call site.
    if (DEMOGRAPHIC_FIELDS.includes(match.field) && !profile.demographics.enabled) {
      return null;
    }

    // The label is passed through because some fields are formatted from it:
    // "Notice period (months)" wants 2, not 60, and "Current CTC (LPA)" wants
    // 18, not 1800000. profileValue also uses it to apply the regional gate.
    const value = profileValue(profile, match.field, match.label);
    if (value) return value;
  }

  return savedAnswerFor(profile, match.label);
}

/**
 * How much of this form we could fill, without touching it. Used to decide
 * whether to offer autofill at all.
 */
export function previewCoverage(profile: Profile, root?: ParentNode): { fillable: number; total: number } {
  const matches = scanForm(root);
  const relevant = matches.filter(
    (match) => match.control.type !== 'hidden' && !match.control.disabled
  );

  // Comboboxes count: `fillComboboxes` answers them in its own pass, so the
  // profile having the value is still the right test for "we can fill this".
  const fillable = relevant.filter((match) => resolveValue(profile, match) !== null).length;
  return { fillable, total: relevant.length };
}
