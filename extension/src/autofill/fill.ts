import type { Control } from './match.js';

/**
 * Writing values into forms that React (or Vue, or Angular) controls.
 *
 * Assigning `element.value = x` updates the DOM but not the framework's
 * internal state, so the field looks filled and then reverts — or submits
 * empty. The fix is to call the *native* value setter, which bypasses the
 * property React installs on the element, and then dispatch the events the
 * framework is actually listening for.
 *
 * Every ATS this extension targets is a React app, so this is not an edge case;
 * it is the normal path.
 */

function nativeSetter(control: Control): ((value: string) => void) | null {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (!descriptor?.set) return null;
  return descriptor.set.bind(control);
}

/** Notify the page in the order a real user interaction would. */
function notify(control: Control): void {
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function setValue(control: Control, value: string): boolean {
  const setter = nativeSetter(control);
  if (setter) setter(value);
  else control.value = value;

  notify(control);
  return control.value === value;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Pick the option that best represents `value`.
 * Exact match first, then prefix, then substring — never a fuzzy guess, since
 * choosing the wrong option in a dropdown is silent and hard to spot.
 */
function findOption(select: HTMLSelectElement, value: string): HTMLOptionElement | null {
  const target = normalize(value);
  if (!target) return null;

  const options = [...select.options].filter((option) => option.value !== '');

  const exact = options.find(
    (option) => normalize(option.text) === target || normalize(option.value) === target
  );
  if (exact) return exact;

  const prefixed = options.find((option) => normalize(option.text).startsWith(target));
  if (prefixed) return prefixed;

  // Only allow substring matching for meaningfully long values, so "no" does
  // not match "Not specified".
  if (target.length >= 4) {
    const contained = options.find((option) => normalize(option.text).includes(target));
    if (contained) return contained;
  }

  return null;
}

function fillSelect(select: HTMLSelectElement, value: string): boolean {
  const option = findOption(select, value);
  if (!option) return false;
  return setValue(select, option.value);
}

/**
 * Radio groups: find the option in the same group whose own label matches.
 * The group's question lives on the fieldset, so each radio's label is the
 * answer text we compare against.
 */
function fillRadioGroup(control: HTMLInputElement, value: string): boolean {
  const name = control.name;
  if (!name) return false;

  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(name) : name;
  const group = document.querySelectorAll<HTMLInputElement>(
    `input[type="radio"][name="${escaped}"]`
  );
  const target = normalize(value);

  for (const radio of group) {
    const own =
      radio.closest('label')?.textContent ??
      document.querySelector(`label[for="${radio.id}"]`)?.textContent ??
      radio.value;
    const candidate = normalize(own ?? '');

    if (candidate === target || candidate.startsWith(target)) {
      if (radio.checked) return true;
      radio.checked = true;
      notify(radio);
      radio.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }
  }

  return false;
}

function fillCheckbox(control: HTMLInputElement, value: string): boolean {
  const wanted = /^(yes|true|1)$/i.test(value.trim());
  if (control.checked === wanted) return true;
  control.checked = wanted;
  notify(control);
  return true;
}

export type FillOutcome = 'filled' | 'skipped-filled' | 'no-match' | 'failed';

/**
 * Write one value into one control.
 *
 * Never clears a field: a null or empty value means "leave it alone". Never
 * overwrites something the user already typed unless `overwrite` is set, so
 * running autofill twice is safe.
 */
export function fillControl(
  control: Control,
  value: string,
  overwrite = false
): FillOutcome {
  if (!value) return 'no-match';

  if (control instanceof HTMLInputElement) {
    const type = control.type.toLowerCase();

    if (type === 'radio') return fillRadioGroup(control, value) ? 'filled' : 'no-match';
    if (type === 'checkbox') return fillCheckbox(control, value) ? 'filled' : 'no-match';
  }

  if (!overwrite && control.value.trim() !== '') return 'skipped-filled';

  if (control instanceof HTMLSelectElement) {
    return fillSelect(control, value) ? 'filled' : 'no-match';
  }

  return setValue(control, value) ? 'filled' : 'failed';
}

/** Briefly outline what was filled, so the user can see what changed. */
export function highlight(control: Control): void {
  const element = control as unknown as HTMLElement;
  const previous = element.style.boxShadow;
  element.style.transition = 'box-shadow 200ms ease';
  element.style.boxShadow = '0 0 0 2px rgba(255, 176, 32, 0.85)';

  setTimeout(() => {
    element.style.boxShadow = previous;
  }, 1600);
}
