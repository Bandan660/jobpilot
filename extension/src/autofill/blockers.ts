/**
 * What the user still has to deal with before this form will submit.
 *
 * Lifted out of the LinkedIn auto-apply driver, where it was the only thing
 * standing between "filled 11 fields" and "filled 11 fields and you are three
 * questions from done". On a Greenhouse form that fits on one screen the
 * difference is small; on a Workday form that does not, it is the feature.
 *
 * Nothing here is platform-specific except the error-message selectors, which
 * are additive — a platform whose errors are not recognised loses that one
 * signal and keeps the rest.
 *
 * It reports. It never fills, never clicks, never submits.
 */

import { visible } from '../dialogs.js';

export interface Blocker {
  label: string;
  /**
   * `empty` is a required control with nothing in it. `invalid` is the page's
   * own validation complaining — a different problem with a different fix, and
   * worth telling apart in the UI: one needs an answer, the other needs a
   * correction.
   */
  kind: 'empty' | 'invalid';
}

/**
 * Rendered validation messages, most specific first.
 *
 * The last two entries are deliberately loose, and every hit is filtered by
 * visibility and length before it is believed — a hidden error slot is the
 * normal resting state of these components, and an "error" whose text runs to
 * a paragraph is a page region, not a message.
 */
const ERROR_SELECTORS = [
  '.artdeco-inline-feedback--error', // LinkedIn
  '.field-error', // Greenhouse
  '.form-error',
  '.error-message',
  '[data-automation-id="errorMessage"]', // Workday
  '[role="alert"]',
  '[aria-live="assertive"]',
];

const MAX_ERROR_LENGTH = 200;
const MAX_BLOCKERS = 8;

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * Required controls only — and *controls*, not anything wearing the attribute.
 *
 * The query this replaced put `[aria-required="true"]` in the selector list
 * and cast every hit to a control. Platforms put that attribute on the wrapper
 * around a field as well as on the field, wrappers are `div`s, and a `div` has
 * no `.value` — so `undefined` read as "unanswered" and every already-answered
 * question came back a blocker. Filter to real controls first, then ask
 * whether they are required.
 */
import { isSearchOrHeaderControl } from './match.js';

function requiredControls(scope: ParentNode): Control[] {
  return [...scope.querySelectorAll<Control>('input, select, textarea')].filter((control) => {
    const tagName = control.tagName?.toLowerCase();
    if (tagName !== 'input' && tagName !== 'select' && tagName !== 'textarea') return false;

    if (control.disabled) return false;
    const type = (control as HTMLInputElement).type?.toLowerCase();
    if (
      type === 'hidden' ||
      type === 'submit' ||
      type === 'button' ||
      type === 'image' ||
      type === 'reset'
    )
      return false;

    if (isSearchOrHeaderControl(control)) return false;

    const id = (control.id || '').toLowerCase();
    const name = (control.name || '').toLowerCase();
    const ariaLabel = (control.getAttribute('aria-label') || '').toLowerCase();
    const className = (control.className || '').toString().toLowerCase();

    if (
      /save-icon|savejob|bookmark|share|search|jobalert|alert-body|report|icon-/i.test(id) ||
      /save-icon|savejob|bookmark|share|search|jobalert|alert-body|report|icon-/i.test(name) ||
      /save-icon|savejob|save job|bookmark|share/i.test(ariaLabel) ||
      /save-icon|savejob|bookmark/i.test(className)
    ) {
      return false;
    }

    if (type === 'radio') return true;

    if (control.required || control.getAttribute('aria-required') === 'true') return true;

    const wrapper = control.closest(FIELD_WRAPPERS);
    if (wrapper) {
      const wrapperId = (wrapper.id || '').toLowerCase();
      const wrapperClass = (wrapper.className || '').toString().toLowerCase();
      if (
        /save-icon|savejob|bookmark|share|search|header/i.test(wrapperId) ||
        /save-icon|savejob|bookmark|share/i.test(wrapperClass)
      ) {
        return false;
      }

      return (
        wrapper.getAttribute('aria-required') === 'true' ||
        wrapper.hasAttribute('required') === true ||
        wrapper.getAttribute('data-required') === 'true'
      );
    }

    return false;
  });
}

/** Where a platform puts an attribute belonging to the field, not the control. */
const FIELD_WRAPPERS = [
  'fieldset',
  '[role="radiogroup"]',
  '[role="group"]',
  '[data-test-form-element]',
  '[data-test-single-typeahead-entity-form-component]',
  '[data-automation-id]',
  '.fb-dash-form-element',
  '[class*="form-element"]',
  '[class*="form-component"]',
  '[class*="form-group"]',
  '.field',
  '.form-group',
].join(', ');

function isEmpty(control: Control, scope: ParentNode): boolean {
  const type = (control as HTMLInputElement).type?.toLowerCase();

  if (type === 'file') {
    return ((control as HTMLInputElement).files?.length ?? 0) === 0;
  }

  if (type === 'radio' || type === 'checkbox') {
    const input = control as HTMLInputElement;

    /*
     * Grouped by name where there is one. `input[name=""]` matches nothing, so
     * a group lookup on an unnamed control reported it unticked whatever its
     * state.
     */
    if (input.name) {
      const group = [
        ...scope.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(input.name)}"]`),
      ];
      return !group.some((member) => member.checked);
    }

    /*
     * Unnamed radios are still a group — by their fieldset, if not by an
     * attribute. Falling straight through to `!input.checked` here reported
     * the "No" of an answered Yes/No pair as an unanswered question, because
     * every member is judged alone and exactly one of them is checked.
     *
     * Harmless while radios were being skipped for being invisible. The moment
     * that skip was lifted it turned every answered unnamed group into a
     * phantom blocker, which stops a run on questions the user has already
     * answered — worse than the miss it replaced.
     *
     * Checkboxes deliberately do not get this: an unnamed checkbox is a
     * standalone consent box, and two of them in one fieldset are two separate
     * questions, not alternatives.
     */
    if (type === 'radio') {
      const fieldset = input.closest('fieldset, [role="radiogroup"], [role="group"]');
      const siblings = [...(fieldset?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])];
      if (siblings.length > 1) return !siblings.some((member) => member.checked);
    }

    return !input.checked;
  }

  return !String(control.value ?? '').trim();
}

/**
 * The question a control is asking, as the user reads it.
 *
 * A blocker the user cannot find on the page is not much better than no
 * blocker at all, so this walks outward until it finds something that was
 * actually rendered next to the field.
 */
export function labelFor(control: Element, scope: ParentNode): string {
  const type = (control as HTMLInputElement).type?.toLowerCase();
  const grouped = type === 'radio' || type === 'checkbox';

  const wrapper = control.closest(FIELD_WRAPPERS);
  const own = [() => labelledBy(control), () => ownLabel(control, scope)];
  const group = [
    () => wrapper?.querySelector('legend')?.textContent,
    () =>
      wrapper?.querySelector(
        '[class*="form-element__label"], [class*="form-component__label"], [data-test-form-element-label], .fb-dash-form-element__label, .label, legend'
      )?.textContent,
  ];

  /*
   * A radio's own label is its *option* — "Yes" — and the question lives on
   * the group. Naming a blocker "Yes" tells the user nothing they can act on,
   * so grouped controls read the fieldset first and fall back to their own
   * label, and everything else does the reverse.
   */
  const candidates = grouped ? [...group, ...own] : [...own, ...group];

  candidates.push(
    () => control.getAttribute('aria-label'),
    () => control.getAttribute('placeholder'),
    () => {
      const name = control.getAttribute('name');
      if (!name || /^(r\d+|input\d*|field\d*|_.*|\d+)$/i.test(name.trim())) return null;
      return name;
    }
  );

  /*
   * First non-empty, not first non-nullish.
   *
   * This chain used `??`, and an empty string is not nullish — so a wrapper
   * containing an empty `<label>` (LinkedIn renders one for its visually
   * hidden radios) resolved to `""` and stopped the chain dead, never reaching
   * the aria-label behind it. `findBlockers` then dropped the blocker outright
   * on `if (!label)`, so an unanswered radio group was silently discarded even
   * once the visibility skip that had been hiding it was lifted.
   */
  for (const read of candidates) {
    const text = clean(read() ?? '');
    if (
      text &&
      !/^radio-group-/i.test(text) &&
      !/save-icon|savejob|bookmark|share-icon|close-icon|report/i.test(text)
    ) {
      return text;
    }
  }

  return 'A required question';
}

/** The control's own label, by `for=` or by being wrapped in one. */
function ownLabel(control: Element, scope: ParentNode): string | null {
  const id = control.getAttribute('id');
  if (id) {
    const byFor = (scope as Element | Document).querySelector?.(`label[for="${CSS.escape(id)}"]`);
    if (byFor?.textContent) return byFor.textContent;
  }
  return control.closest('label')?.textContent ?? null;
}

/** `aria-labelledby`, which is how most accessible widgets name a group. */
function labelledBy(control: Element): string | null {
  const ids = control.getAttribute('aria-labelledby');
  if (!ids) return null;

  const doc = control.ownerDocument;
  const text = ids
    .split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

  return text || null;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim().slice(0, 120);
}

/**
 * Required-but-empty controls, plus whatever the page is already complaining
 * about. Deduplicated by label, capped, and ordered empties-first because an
 * unanswered question is the more actionable of the two.
 */
export function findBlockers(scope: ParentNode = document): Blocker[] {
  const seen = new Set<string>();
  const empties: Blocker[] = [];
  const invalids: Blocker[] = [];

  for (const control of requiredControls(scope)) {
    const type = (control as HTMLInputElement).type;
    if (type === 'hidden' || control.disabled) continue;

    /*
     * Three input types are exempt from the visibility test. Everything else
     * is not.
     *
     * `file`, `radio` and `checkbox` are almost never visible themselves: the
     * conventional pattern is a zero-sized or `opacity: 0` input behind a
     * styled label, button or swatch, and that label is what the user sees and
     * clicks. Judging them by their own box therefore skips every upload
     * field and every radio group on every platform.
     *
     * Both halves were confirmed on live LinkedIn markup. A run stalled with
     * every visible field answered, no blockers found, and the form refusing
     * to advance — the panel's own dump listed `radio · checked · hidden` and
     * `file · 0 file · hidden`, the two things the check was throwing away.
     * `isEmpty` has had `file` and group branches the whole time; they were
     * unreachable.
     *
     * A genuinely hidden required control is still worth reporting, because
     * the form will refuse for it either way, and a named question the user
     * cannot immediately find beats a silent stall.
     */
    const exemptFromVisibility = type === 'file' || type === 'radio' || type === 'checkbox';
    if (!exemptFromVisibility && !visible(control)) continue;

    if (!isEmpty(control, scope)) continue;

    const label = labelFor(control, scope);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    empties.push({ label, kind: 'empty' });
  }

  for (const selector of ERROR_SELECTORS) {
    for (const node of scope.querySelectorAll(selector)) {
      // A hidden error slot is these components' resting state, and a stale
      // message in one blocks a field the user has already corrected.
      if (!visible(node)) continue;

      const text = clean(node.textContent ?? '');
      if (!text || text.length > MAX_ERROR_LENGTH || seen.has(text)) continue;
      seen.add(text);
      invalids.push({ label: text, kind: 'invalid' });
    }
  }

  return [...empties, ...invalids].slice(0, MAX_BLOCKERS);
}
