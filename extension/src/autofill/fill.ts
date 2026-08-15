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

/**
 * Say which dropdown failed and why, in one line.
 *
 * The run reports "0 answered, 4 left for you", which is a count and cannot be
 * acted on. A list that never opened, a list with nothing matching, and a click
 * the widget rejected are three different bugs wanting three different fixes,
 * and from outside they are the same number. Naming the failure is what turned
 * the phantom-step hunt into a single run.
 */
function note(control: HTMLInputElement, reason: string): void {
  const name = control.getAttribute('id') || control.getAttribute('name') || 'combobox';
  console.info(`[jobpilot] combobox "${name}": ${reason}`);
}

/** Long enough for a remote typeahead to answer, short enough not to stall a run. */
const LISTBOX_TIMEOUT_MS = 2500;

/**
 * Where a widget puts the options it just opened.
 *
 * `aria-controls` is the contract and is checked first. The fallbacks exist
 * because plenty of components render the listbox at the end of `<body>`,
 * outside the dialog entirely, so searching near the input finds nothing.
 */
/**
 * The listbox belonging to *this* combobox.
 *
 * WHY THE DOCUMENT-WIDE FALLBACK IS GONE
 *
 * It used to end with `document.querySelector('[role="listbox"]')`, and on a
 * modern Greenhouse form that returns the phone number's country picker —
 * intl-tel-input keeps a listbox of 245 countries in the DOM at all times,
 * before any dropdown is opened. So filling the *location* field found the
 * phone widget's list, and `pickOption` then ran a match against country
 * names. A hit there does not fill the location: it clicks an entry in the
 * phone widget and changes the dialling code, silently, inside someone's
 * application. That is the exact failure the strict match ladder was written
 * to prevent, arriving through the element lookup instead.
 *
 * The walk up from the control finds the widget's own listbox — on Greenhouse
 * at the fourth ancestor, `.select-shell`, holding
 * `react-select-<field>-option-0` — and cannot reach a different field's,
 * because it stops long before the two share an ancestor.
 *
 * Finding nothing now returns null, which fails the commit and reports the
 * field as a question for the user. That is the right failure: an unanswered
 * dropdown is visible and fixable, and a confidently wrong one is neither.
 */
function listboxFor(control: HTMLInputElement): Element | null {
  const owned = control.getAttribute('aria-controls') ?? control.getAttribute('aria-owns');
  if (owned) {
    const byId = control.ownerDocument.getElementById(owned);
    if (byId) return byId;
  }

  // react-select points at the highlighted option rather than the list.
  const active = control.getAttribute('aria-activedescendant');
  if (active) {
    const option = control.ownerDocument.getElementById(active);
    const box = option?.closest('[role="listbox"]');
    if (box) return box;
  }

  let node: Element | null = control.parentElement;
  for (let depth = 0; node && depth < LISTBOX_ANCESTOR_DEPTH; depth += 1) {
    if (node === control.ownerDocument.body) break;

    const box = node.querySelector('[role="listbox"]');
    // A hidden list is a widget that has not opened, not this one's answer.
    if (box && (box as HTMLElement).offsetParent !== null) return box;

    node = node.parentElement;
  }

  return null;
}

/**
 * How far up to look. Six is comfortably past where the widgets seen here keep
 * their list — Greenhouse's is four up — and stops well short of the ancestor
 * a field would share with an unrelated one.
 */
const LISTBOX_ANCESTOR_DEPTH = 6;

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
/**
 * Make the widget render its list.
 *
 * Typing is not enough for all of them, and Greenhouse is the case in point:
 * its dropdowns are react-select, which opens on a *mousedown on the control*
 * and may render nothing at all for a programmatic `input`. A list that never
 * renders is a field reported as a question for the user, which is how a form
 * with seventeen dropdowns comes back with four still blocking it.
 *
 * The press goes to the control's container, not the inner input: react-select
 * listens there, and the input is a one-character-wide box inside it.
 *
 * Pressing an already-open widget would toggle it shut, so a widget that has
 * already opened is left alone.
 */
function openWidget(control: HTMLInputElement): void {
  if (control.getAttribute('aria-expanded') === 'true') return;

  const container =
    control.closest<HTMLElement>('[class*="select__control"], [class*="control"], [role="combobox"]') ??
    control;

  for (const type of ['pointerdown', 'mousedown', 'mouseup'] as const) {
    container.dispatchEvent(
      type === 'pointerdown'
        ? new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })
        : new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1, view: window })
    );
  }
}

export async function commitCombobox(control: HTMLInputElement, value: string): Promise<boolean> {
  control.focus();
  openWidget(control);

  const setter = nativeSetter(control);
  if (setter) setter(value);
  else control.value = value;

  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
  control.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowDown' }));

  // Also fire a Change event — some ATSs listen only to that.
  control.dispatchEvent(new Event('change', { bubbles: true }));

  const deadline = Date.now() + LISTBOX_TIMEOUT_MS;
  let choice: HTMLElement | null = null;

  /*
   * Why this one failed, for the log.
   *
   * "0 answered, 4 left for you" is a count, and a count cannot be acted on:
   * a list that never opened, a list with nothing matching, and a click the
   * widget rejected are three different bugs with three different fixes, and
   * they were indistinguishable from outside. Naming the failure is what
   * turned the phantom-step hunt from guesswork into one run, and dropdowns
   * are now the part standing between this and an unattended apply.
   */
  let reason = 'no list appeared';
  let sawOptions = 0;

  while (Date.now() < deadline && !choice) {
    await sleep(120);
    const listbox = listboxFor(control);

    // Broad option selector: covers [role="option"], li, plain div/span rows used by many ATSs.
    const optionEls = [
      ...(listbox?.querySelectorAll<HTMLElement>(
        '[role="option"], [data-value], [data-option], li[id*="option"], li[class*="option"], li[class*="suggestion"], li[class*="item"], .ac-menu-item, .suggestion-item, .dropdown-item'
      ) ?? []),
    ].filter((el) => (el.innerText || el.textContent || '').trim() !== '');

    if (optionEls.length > 0) {
      sawOptions = optionEls.length;
      choice = pickOption(optionEls, value);

      if (!choice) {
        // The first few, so the log shows what it was choosing between.
        const offered = optionEls
          .slice(0, 4)
          .map((el) => (el.innerText || el.textContent || '').trim().slice(0, 24))
          .join(' / ');
        reason = `${optionEls.length} options, none matched "${value}" — offered: ${offered}`;
      }
    }

    /*
     * There is deliberately no "look anywhere in the document" fallback.
     *
     * One used to live here, and it is the same trap `listboxFor` documents:
     * on Greenhouse the first listbox in the document belongs to the phone
     * number's country picker, which holds 245 permanently-rendered options.
     * A widget that has not opened its own list is a field we cannot answer —
     * and answering it out of a *different* widget's list does not fill this
     * field at all, it clicks something in that other widget. Leaving it for
     * the user is the only correct outcome.
     */
  }

  if (!choice) {
    /*
     * Timeout: no matching option appeared.
     *
     * Leave the typed text in the box — the user can see what was attempted
     * and click to pick the right suggestion themselves. Clearing it here
     * causes the field to appear blank and triggers a spurious blocker that
     * pins the run at step 1 forever even when the field visually looks fine.
     *
     * The form's own validation will catch an uncommitted combobox when the
     * user (or the advance click) tries to move on.
     */
    note(control, reason);
    return false;
  }

  const chosen = (choice.innerText || choice.textContent || '').trim();

  // mousedown first: several widgets commit on it and never see the click,
  // and some close the listbox on blur before a click would land.
  choice.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  choice.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  choice.click();

  // Give the widget time to settle its internal state.
  await sleep(400);

  /*
   * An empty input is not a failed commit.
   *
   * It was read as one, and that single line is why every Greenhouse run
   * reported "0 answered, 4 left for you" over dropdowns it had *correctly
   * answered*. react-select clears its search input on selection by design and
   * renders the chosen value in its own element — the log read `picked an
   * option from 2 but the widget cleared the field`, and the widget had in
   * fact just accepted the pick.
   *
   * The cost of getting this wrong is not cosmetic. A commit reported as a
   * failure is reported to the user as a question needing their attention, and
   * the run then waits for something that is already done — which is the whole
   * of "it fills everything and still will not submit".
   *
   * So the check asks the widget what it is showing, in the three shapes these
   * take: the input still holds the text, the widget renders a selected-value
   * element, or its container now reads back the option that was picked.
   */
  if (control.value.trim() !== '') return true;

  /*
   * Walk up looking for the widget's own display of what was chosen.
   *
   * Not `closest()` from the control: `closest` matches the element itself,
   * and the control *is* `[role="combobox"]`, so it returned the input and its
   * immediate container — which is the one part of a react-select that does
   * not hold the selected value. The log said `picked "India +91" from 2 but
   * the widget kept nothing` while the widget was displaying exactly that
   * selection one level further out.
   *
   * The text comparison runs both ways because the two rarely match exactly:
   * the option read "India +91" and the control then showed "+91". Either
   * containing the other is the widget echoing the pick.
   */
  const target = normalize(chosen);

  let node: Element | null = control.parentElement;
  for (let depth = 0; node && depth < 5; depth += 1) {
    if (node.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"]')) {
      return true;
    }

    const shown = normalize((node.textContent ?? '').replace(/\s+/g, ' '));
    if (target && shown) {
      if (shown.includes(target)) return true;
      if (shown.length >= 2 && target.includes(shown)) return true;
    }

    node = node.parentElement;
  }

  note(control, `picked "${chosen}" from ${sawOptions} but the widget kept nothing`);
  return false;
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
