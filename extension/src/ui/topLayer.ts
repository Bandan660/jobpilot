/**
 * Getting jobpilot's own chrome above the host page, and keeping the host page
 * from noticing when it is clicked.
 *
 * Shared by the panel and the banner because both learned the same two lessons
 * the same painful way, and a third copy is how they drift.
 *
 * WHY Z-INDEX IS NOT ENOUGH
 *
 * `z-index: 2147483647` is the largest value there is, and against a modern
 * modal it loses. LinkedIn's Easy Apply is a native `<dialog>` opened with
 * `showModal()`, which promotes it into the browser's *top layer* — a separate
 * painting surface above every z-index in the document, unconditionally. Our
 * overlay is drawn underneath it and the dialog's backdrop takes the clicks.
 *
 * A `manual` popover is the cheapest ticket into the same layer. `showModal()`
 * would also work and would be catastrophic: it brings a focus trap, a
 * backdrop and light-dismiss, and the page underneath is someone's
 * half-finished application.
 *
 * WHY THE PAGE MUST NOT SEE OUR CLICKS
 *
 * A modal treats a click anywhere outside itself as the user leaving, and our
 * overlay is outside itself. Pressing "Resume application" reached LinkedIn's
 * own document-level listener and raised "Save this application? Discard /
 * Save" over a form the user had just spent minutes filling in by hand.
 *
 * This only became reachable once the overlay moved into the top layer. While
 * the modal painted over it the click never landed, so the same handler sat
 * there the whole time with nothing to trigger it.
 */

/**
 * Undo the UA stylesheet for `[popover]`.
 *
 * Left alone it centres the element with `inset: 0` and `margin: auto` inside
 * a bordered, opaque, padded box — a grey frame in the middle of the page
 * rather than chrome pinned to an edge. Appended after the caller's own
 * positioning so it cannot clobber `top`/`right`.
 */
export const POPOVER_RESET = [
  'left: auto',
  'bottom: auto',
  'margin: 0',
  'border: 0',
  'padding: 0',
  'background: transparent',
  'overflow: visible',
];

/** Put a mounted host element into the top layer. Safe to call on any browser. */
export function promoteToTopLayer(host: HTMLElement): void {
  // Without support the attribute would only set `display: none` on the host,
  // hiding the very thing it was meant to raise. The z-index stays as fallback.
  if (typeof host.showPopover !== 'function') return;

  try {
    host.setAttribute('popover', 'manual');
    host.showPopover();
  } catch {
    host.removeAttribute('popover');
  }
}

/**
 * Move a host back to the top of the top layer.
 *
 * Order in there is order of promotion, so a dialog opened after ours lands on
 * top of it — and during an apply run jobpilot opens that dialog itself.
 */
export function reraise(host: HTMLElement): void {
  if (!host.hasAttribute('popover')) return;

  try {
    host.hidePopover();
    host.showPopover();
  } catch {
    /* Still painted, just underneath. Nothing here can recover that. */
  }
}

/**
 * Stop the host page seeing interaction with our chrome.
 *
 * Stopped at the host, which is where events from a closed shadow root
 * surface. Everything inside has already run by then — propagation completes
 * within the shadow tree before the boundary is crossed — so our own controls
 * are unaffected. Focus events go too: a focus trap yanking the caret out of
 * the sign-in field is the same bug wearing a hat.
 */
export function sealEvents(host: HTMLElement): void {
  const types = [
    'pointerdown',
    'mousedown',
    'pointerup',
    'mouseup',
    'click',
    'dblclick',
    'touchstart',
    'touchend',
    'focusin',
    'focusout',
  ];

  for (const type of types) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }
}
