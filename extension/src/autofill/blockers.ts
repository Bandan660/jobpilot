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

function visible(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

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
function requiredControls(scope: ParentNode): Control[] {
  return [...scope.querySelectorAll<Control>('input, select, textarea')].filter(
    (control) => control.required || control.getAttribute('aria-required') === 'true'
  );
}

function isEmpty(control: Control, scope: ParentNode): boolean {
  const type = (control as HTMLInputElement).type?.toLowerCase();

  if (type === 'file') {
    return ((control as HTMLInputElement).files?.length ?? 0) === 0;
  }

  if (type === 'radio' || type === 'checkbox') {
    const input = control as HTMLInputElement;
    /*
     * Grouped by name, except when there is no name — which happens on
     * standalone consent checkboxes. `input[name=""]` matches nothing, so a
     * group lookup there reported every such box unticked whatever its state.
     */
    if (!input.name) return !input.checked;

    const group = [
      ...scope.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(input.name)}"]`),
    ];
    return !group.some((member) => member.checked);
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
  const id = control.getAttribute('id');
  if (id) {
    const label = (scope as Element | Document).querySelector?.(`label[for="${CSS.escape(id)}"]`);
    const text = label?.textContent?.trim();
    if (text) return clean(text);
  }

  const wrapper = control.closest(
    '[data-test-form-element], [data-automation-id], fieldset, .fb-dash-form-element, .field, .form-group'
  );
  const legend = wrapper?.querySelector('legend, label, .fb-dash-form-element__label, .label');
  const text =
    legend?.textContent?.trim() ??
    control.getAttribute('aria-label') ??
    control.getAttribute('placeholder') ??
    control.getAttribute('name') ??
    'A required question';

  return clean(text);
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
    if (type === 'hidden' || control.disabled || !visible(control)) continue;
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
