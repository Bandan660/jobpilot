import {
  DEMOGRAPHIC_FIELDS,
  answerKey,
  profileValue,
  type Profile,
  type ProfileField,
} from '@jobpilot/shared';
import { scanForm, type FieldMatch } from './match.js';
import { fillControl, highlight, type FillOutcome } from './fill.js';

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

  const fillable = relevant.filter((match) => resolveValue(profile, match) !== null).length;
  return { fillable, total: relevant.length };
}
