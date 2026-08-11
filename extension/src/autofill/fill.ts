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
      radio.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }));
      radio.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      radio.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }));
      radio.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      radio.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }
  }

  return false;
}

function fillCheckbox(control: HTMLInputElement, value: string): boolean {
  const text = value.trim().toLowerCase();
  const wanted =
    /^(yes|true|1|consent|i consent|agree|accept|read and understand|i agree)$/i.test(text) ||
    text.includes('consent') ||
    text.includes('agree') ||
    text.includes('accept');

  if (control.checked === wanted) return true;
  control.checked = wanted;
  notify(control);

  // Dispatch mouse and pointer events for framework state binding (LinkedIn Ember/React)
  control.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })
  );
  control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  control.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })
  );
  control.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  control.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  const label = control.closest('label') ?? document.querySelector(`label[for="${control.id}"]`);
  if (label && label instanceof HTMLElement) {
    try {
      label.click();
    } catch {
      // Ignore click errors on synthetic labels
    }
  }

  return true;
}

/**
 * A text box that is really a dropdown — a typeahead, an autocomplete, a
 * location picker.
 *
 * These must be left alone, and that is the opposite of what it looks like.
 *
 * `setValue` puts the text in and fires `input`/`change`, which is enough for
 * every ordinary field and useless here: the widget's value is not its text,
 * it is the option the user picked out of the listbox that typing opens.
 * Writing the text alone produces a box that reads "Hyderabad, Telangana,
 * India" over a component holding nothing.
 *
 * That is the worst possible state, worse than leaving it blank, because
 * nothing can see it is wrong. `findBlockers` asks whether the control has a
 * value and it does. The panel counts it among the filled. The form then
 * refuses to advance with the field looking perfectly complete — which is
 * exactly how a run died on LinkedIn's "Location (city)" with every visible
 * field populated.
 *
 * So: leave it empty, and let it be reported as an unanswered required
 * question like any other. `CLAUDE.md` puts the rule plainly — a blank the
 * user notices beats a wrong answer they do not — and an uncommitted
 * typeahead is a wrong answer wearing a filled field's clothes.
 *
 * The alternative is to type, wait for the listbox and click the matching
 * option. Better when it lands, and it means clicking inside someone's form
 * on a guess about which option is theirs.
 */
export function isCombobox(control: Control): boolean {
  if (!(control instanceof HTMLInputElement)) return false;

  const autocomplete = control.getAttribute('aria-autocomplete');
  return (
    control.getAttribute('role') === 'combobox' ||
    autocomplete === 'list' ||
    autocomplete === 'both'
  );
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

  // Text alone does not answer one of these; see `isCombobox`.
  if (isCombobox(control)) return 'no-match';

  return setValue(control, value) ? 'filled' : 'failed';
}

/* ------------------------------- comboboxes ------------------------------ */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Long enough for a remote typeahead to answer, short enough not to stall a run. */
const LISTBOX_TIMEOUT_MS = 2500;

/**
 * Where a widget puts the options it just opened.
 *
 * `aria-controls` is the contract and is checked first. The fallbacks exist
 * because plenty of components render the listbox at the end of `<body>`,
 * outside the dialog entirely, so searching near the input finds nothing.
 */
function listboxFor(control: HTMLInputElement): Element | null {
  const owned = control.getAttribute('aria-controls') ?? control.getAttribute('aria-owns');
  if (owned) {
    const byId = control.ownerDocument.getElementById(owned);
    if (byId) return byId;
  }

  const dialog = control.closest('dialog, [role="dialog"], [aria-modal="true"]');
  return (
    dialog?.querySelector('[role="listbox"]') ??
    control.ownerDocument.querySelector('[role="listbox"]')
  );
}

/**
 * The option that actually means `value`.
 *
 * Same ladder as `findOption` for a `<select>`, and strict for the same
 * reason: picking the wrong entry out of a location list is silent, and the
 * application carries it. "Hyderabad" matching "Hyderabad, Telangana, India"
 * is the prefix rung, which is the common case — a profile stores a city and
 * the widget offers a fully qualified place.
 */
function pickOption(options: HTMLElement[], value: string): HTMLElement | null {
  const target = normalize(value);
  if (!target) return null;

  const text = (option: HTMLElement) => normalize(option.innerText || option.textContent || '');

  return (
    options.find((option) => text(option) === target) ??
    options.find((option) => text(option).startsWith(target)) ??
    options.find((option) => target.startsWith(text(option)) && text(option).length >= 4) ??
    (target.length >= 4 ? options.find((option) => text(option).includes(target)) : undefined) ??
    null
  );
}

function clearControl(control: HTMLInputElement): void {
  const setter = nativeSetter(control);
  if (setter) setter('');
  else control.value = '';
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
}

/**
 * Answer a typeahead the way a person does: type, wait, pick.
 *
 * `fillControl` refuses these outright, because writing the text and firing
 * `input` leaves the box reading correctly over a component holding nothing —
 * a state no check on the page can see, and the reason a run died on
 * LinkedIn's "Location (city)" with every visible field populated.
 *
 * Committing a selection is the only way to actually answer one, and it is
 * genuinely riskier than filling a text field: it clicks an entry chosen by
 * string match inside someone's application. Kept honest by three things —
 * the match ladder never guesses fuzzily, a failure clears the box rather than
 * leaving the uncommitted text behind, and an empty required field is then
 * reported as a question for the user instead of being silently carried into a
 * submit.
 *
 * `keydown`/`keyup` go out alongside `input` because a good many typeaheads
 * open their listbox on the key event and ignore a programmatic `input`
 * entirely.
 */
export async function commitCombobox(control: HTMLInputElement, value: string): Promise<boolean> {
  control.focus();

  const setter = nativeSetter(control);
  if (setter) setter(value);
  else control.value = value;

  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
  control.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowDown' }));

  const deadline = Date.now() + LISTBOX_TIMEOUT_MS;
  let choice: HTMLElement | null = null;

  while (Date.now() < deadline && !choice) {
    await sleep(120);
    const listbox = listboxFor(control);
    const options = [...(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].filter(
      (option) => (option.innerText || option.textContent || '').trim() !== ''
    );
    if (options.length > 0) choice = pickOption(options, value);
  }

  if (!choice) {
    clearControl(control);
    return false;
  }

  // mousedown first: several widgets commit on it and never see the click,
  // and some close the listbox on blur before a click would land.
  choice.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  choice.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  choice.click();

  await sleep(200);

  // The widget owns the final text. Empty means the click was not taken, and
  // leaving it that way is the honest outcome — it becomes a named question.
  if (control.value.trim() === '') return false;
  return true;
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
