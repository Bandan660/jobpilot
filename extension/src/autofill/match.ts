import type { ProfileField } from '@jobpilot/shared';
import { BLOCKED_INPUT_TYPES, BLOCKED_PATTERNS, FIELD_RULES } from './rules.js';

export type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface FieldMatch {
  control: Control;
  field: ProfileField | null;
  /** Higher is more certain. Used to break ties, and to skip weak guesses. */
  score: number;
  /** The question text as shown to the user, for saved-answer lookup. */
  label: string;
}

/** Below this we would be guessing, and a wrong value is worse than a blank. */
const MIN_SCORE = 40;

function text(node: Element | null | undefined): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** The visible question for a control, from whichever source has one. */
export function labelFor(control: Control): string {
  const id = control.id;

  if (id) {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
    const explicit = document.querySelector(`label[for="${escaped}"]`);
    if (explicit) return text(explicit);
  }

  const wrapping = control.closest('label');
  if (wrapping) return text(wrapping);

  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((ref) => text(document.getElementById(ref)))
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  const ariaLabel = control.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // Radio and checkbox groups put the real question on the fieldset legend or group label,
  // and each control's own label is just the option ("Yes", "No").
  const groupContainer = control.closest(
    'fieldset, [role="radiogroup"], [role="group"], [class*="form-element"], [class*="form-component"]'
  );
  const legend = groupContainer?.querySelector(
    'legend, [class*="form-element__label"], [class*="form-component__label"], [data-test-form-element-label]'
  );
  if (legend) return text(legend);

  // Last resort: the nearest preceding block of text in the same container.
  const container = control.closest('div, section, li, td');
  const heading = container?.querySelector('label, legend, h1, h2, h3, h4, p, span');
  if (heading && !heading.contains(control)) return text(heading);

  return '';
}

/**
 * Everything we know about a control, lowercased into one string.
 * Order does not matter — rules are regex tests, not positional.
 */
function haystackFor(control: Control, label: string): string {
  const parts = [
    control.getAttribute('name') ?? '',
    control.id,
    control.getAttribute('placeholder') ?? '',
    control.getAttribute('aria-label') ?? '',
    control.getAttribute('data-qa') ?? '',
    control.getAttribute('data-testid') ?? '',
    label,
  ];

  return parts
    .join(' ')
    .toLowerCase()
    // Split camelCase and snake/kebab so "firstName" and "first_name" both
    // read as "first name" to the patterns.
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fields we must never write to, regardless of what the rules say. */
export function isBlocked(control: Control, haystack: string): boolean {
  const type = (control.getAttribute('type') ?? '').toLowerCase();
  if (BLOCKED_INPUT_TYPES.has(type)) return true;
  if (control.getAttribute('autocomplete') === 'off' && type === 'password') return true;
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function matchControl(control: Control): FieldMatch {
  const label = labelFor(control);
  const haystack = haystackFor(control, label);

  if (isBlocked(control, haystack)) {
    return { control, field: null, score: 0, label };
  }

  const autocomplete = (control.getAttribute('autocomplete') ?? '').toLowerCase().trim();
  const type = (control.getAttribute('type') ?? 'text').toLowerCase();

  let best: { field: ProfileField; score: number } | null = null;

  for (const rule of FIELD_RULES) {
    if (rule.negative?.some((pattern) => pattern.test(haystack))) continue;
    if (rule.inputTypes && control instanceof HTMLInputElement && !rule.inputTypes.includes(type)) {
      continue;
    }

    let score = 0;

    // A spec-defined autocomplete token is a contract, not a guess.
    if (autocomplete && rule.autocomplete?.includes(autocomplete)) {
      score = 100;
    } else if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      score = 60;
    }

    if (score === 0) continue;
    score += rule.weight ?? 0;

    if (!best || score > best.score) best = { field: rule.field, score };
  }

  if (!best || best.score < MIN_SCORE) {
    return { control, field: null, score: best?.score ?? 0, label };
  }

  return { control, field: best.field, score: best.score, label };
}

/** All fillable controls in a form or document, already matched. */
export function scanForm(root: ParentNode = document): FieldMatch[] {
  const controls = root.querySelectorAll<Control>('input, select, textarea');
  const matches: FieldMatch[] = [];

  for (const control of controls) {
    // `readOnly` exists on input and textarea but not on select.
    if (control.disabled) continue;
    if ('readOnly' in control && control.readOnly) continue;

    // Skip anything the user cannot see; hidden steps of a multi-page form
    // will be filled when they become visible.
    if (!control.offsetParent && control.type !== 'radio' && control.type !== 'checkbox') {
      continue;
    }

    matches.push(matchControl(control));
  }

  return matches;
}
