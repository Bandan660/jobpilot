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
  '[aria-errormessage]',
  /*
   * The catch-all, for the ATS nobody has written an entry for.
   *
   * A run stalled on a custom board whose only signal was the words "Invalid
   * input" under the field: no `aria-invalid`, no `role="alert"`, and a class
   * none of the entries above match. The step was unanswerable and the panel
   * could not say why, because every hook this file knew about was absent.
   *
   * Matching the substring rather than the exact class is what makes that
   * reachable — `invalid-feedback`, `text-error`, `FieldError__message` and
   * `has-error` are all the same idea wearing a different framework's naming.
   * It is loose on purpose and safe because of what filters it: visible only,
   * short only, innermost only, and deduplicated.
   */
  '[class*="error" i]',
  '[class*="invalid" i]',
];

/**
 * A message, not a region.
 *
 * The substring selectors above match wrappers as readily as messages — a
 * `<div class="field-with-error">` contains the label, the input and the
 * complaint, and reporting its text would hand back the whole field as one
 * unreadable string. Anything containing another match is therefore skipped in
 * favour of the innermost node, which is the message itself.
 */
function innermost(nodes: Element[]): Element[] {
  return nodes.filter((node) => !nodes.some((other) => other !== node && node.contains(other)));
}

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
 * Which field a loose validation message belongs to, best effort.
 *
 * Two ways, in order of how much the page told us. If a control points at the
 * message by id, that is authoritative. Otherwise the message was rendered
 * into the field's own group, so the nearest ancestor wrapping exactly one
 * control is it — the depth is capped because past a few levels the ancestor
 * is the step, not the field, and "every question on this page" is not an
 * attribution.
 *
 * Returning '' is a normal outcome, not a failure: the message is still worth
 * reporting unattributed, and a wrong field name would be worse than none.
 */
function fieldForError(node: Element, scope: ParentNode): string {
  if (node.id) {
    const id = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(node.id) : node.id;
    const owner = scope.querySelector<Control>(
      `[aria-describedby~="${id}"], [aria-errormessage~="${id}"]`
    );
    if (owner) return labelFor(owner, scope);
  }

  let box = node.parentElement;
  for (let depth = 0; box && depth < 4; depth += 1, box = box.parentElement) {
    const controls = box.querySelectorAll<Control>('input, select, textarea');
    if (controls.length === 1) return labelFor(controls[0], scope);
  }

  return '';
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

  /*
   * A field the page has marked invalid, named by its own label.
   *
   * This is the answered-but-rejected case, and it is the one that used to
   * stall a run silently. `ERROR_SELECTORS` below finds the *message*, which
   * only helps when the platform renders one into a container this file knows
   * the class of. When it does not — or when the complaint lives in a tooltip,
   * or the message node is styled in a way `visible()` rejects — the field is
   * non-empty, so the empties pass skips it, no error text is found, and
   * `findBlockers` returns nothing at all. The driver then reads "nothing is
   * wrong", presses Next against a form that will never accept it, and the run
   * dies on the advance cap with no idea what the form objected to.
   *
   * `aria-invalid` is the platform-independent half of that state and LinkedIn
   * sets it. It was already being read — but only by `describeStep`, and only
   * once the run had given up, which is the one moment it is too late to help.
   *
   * Not restricted to required controls: an optional field with a format the
   * page dislikes blocks the step exactly as hard as a mandatory one.
   */
  for (const control of scope.querySelectorAll<Control>('input, select, textarea')) {
    if ((control as HTMLInputElement).type === 'hidden' || control.disabled) continue;

    const marked = control.getAttribute('aria-invalid') === 'true';

    /*
     * The browser's own verdict, for pages that never set the attribute.
     * `type="number"`, `pattern`, `min`/`max` and `maxlength` are all enforced
     * here whether or not the page thought to mirror it into ARIA.
     *
     * `valueMissing` is excluded deliberately: a required-but-empty field is
     * already the empties pass's job, and reporting it twice would name the
     * same question once as unanswered and once as wrong.
     */
    const validity = control.validity as ValidityState | undefined;
    const nativelyInvalid = !!validity && !validity.valid && !validity.valueMissing;

    if (!marked && !nativelyInvalid) continue;

    // Whatever the page attached to this field as its explanation. Preferred
    // over the bare label, because "Phone — enter a number without spaces" is
    // actionable and "Phone" on its own is a riddle.
    const message = (control.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .map((id) => clean(control.ownerDocument.getElementById(id)?.textContent ?? ''))
      .find((text) => text.length > 0 && text.length <= MAX_ERROR_LENGTH);

    const field = labelFor(control, scope);
    const label = field && message ? `${field} — ${message}` : message || field;
    if (!label || seen.has(label)) continue;

    // Claim the raw message as well, so the pass below does not report the
    // same complaint again stripped of the field name that makes it useful.
    if (message) seen.add(message);
    seen.add(label);
    invalids.push({ label, kind: 'invalid' });
  }

  const errorNodes = innermost(
    ERROR_SELECTORS.flatMap((selector) => [...scope.querySelectorAll(selector)])
  );

  for (const node of errorNodes) {
    // A hidden error slot is these components' resting state, and a stale
    // message in one blocks a field the user has already corrected.
    if (!visible(node)) continue;

    const text = clean(node.textContent ?? '');
    if (!text || text.length > MAX_ERROR_LENGTH || seen.has(text)) continue;

    // "Invalid input" on its own is not a question anyone can act on. Naming
    // the field it belongs to is the difference between a report the user can
    // use and one they have to go hunting through the form to interpret.
    const field = fieldForError(node, scope);
    const label = field ? `${field} — ${text}` : text;
    if (seen.has(label)) continue;

    seen.add(text);
    seen.add(label);
    invalids.push({ label, kind: 'invalid' });
  }

  return [...empties, ...invalids].slice(0, MAX_BLOCKERS);
}
