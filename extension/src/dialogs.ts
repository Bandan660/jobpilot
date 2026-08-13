/**
 * Finding the modal an application is being filled in.
 *
 * Deliberately at the top level and importing nothing: the adapters, the apply
 * driver and the blocker check all need this, and they sit in layers that must
 * not import each other.
 *
 * TWO BUGS THIS EXISTS TO STOP REPEATING
 *
 * **First-match blindness.** Every copy of this was a single
 * `document.querySelector` whose result was tested once — if the first dialog
 * in document order had no form controls, the answer was "no form here" and
 * nothing looked further. LinkedIn renders other dialogs on a posting, and one
 * of them landing above the Easy Apply modal was enough to make the driver
 * report "No application form on this page" with the form open in front of the
 * user. Every selector's every match is examined now.
 *
 * **`<dialog>` is not `div[role="dialog"]`.** LinkedIn moved Easy Apply to a
 * native `<dialog>` opened with `showModal()`. Selectors naming a `div`, or
 * requiring an explicit `role`, stopped matching it — silently, because "no
 * dialog found" is indistinguishable from "no dialog open". Three separate
 * features broke on this one change: the apply driver could not find the form,
 * autofill fell back to the whole document, and submit detection stopped
 * firing, so applications that were sent were never recorded.
 *
 * The same migration is why the panel needs the top layer; see `ui/topLayer.ts`.
 *
 * Visibility is what keeps the wide search honest. These component libraries
 * keep detached and zero-sized dialogs around as their resting state, and
 * matching one hands the caller a form nobody can see.
 */

/** Modal containers an application plausibly lives in, most specific first. */
export const DIALOG_SELECTORS = [
  '.jobs-easy-apply-modal',
  '[data-test-modal]',
  'dialog[open]',
  '[aria-modal="true"]',
  'div[role="dialog"]',
  '[class*="chatbot" i]',
  '[class*="apply-message" i]',
  '[class*="drawer" i]',
  '[class*="slider" i]',
  '[class*="bot-container" i]',
  '[class*="chat-container" i]',
  '.chatbot',
  '#chatbot',
];

export function visible(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Does this hold anything fillable? The test that separates a form from a notice. */
export function hasFormControls(node: ParentNode): boolean {
  return (
    node.querySelector(
      'input, select, textarea, [contenteditable="true"], [class*="option-btn"], [class*="chip"]'
    ) !== null
  );
}

/**
 * The first visible dialog the caller will accept.
 *
 * Pass `hasFormControls` to find a form; pass nothing to find any dialog,
 * which is what confirmation screens need — they have no controls left.
 */
export function findDialog(accept: (el: HTMLElement) => boolean = () => true): HTMLElement | null {
  for (const selector of DIALOG_SELECTORS) {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      if (visible(node) && accept(node)) return node;
    }
  }
  return null;
}
