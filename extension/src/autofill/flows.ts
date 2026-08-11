import type { AtsProvider } from '@jobpilot/shared';
import { findDialog, hasFormControls } from '../dialogs.js';
import { clickElement, findButton, type ApplyFlow } from './apply.js';

/**
 * Per-platform configuration for the assisted-apply driver.
 *
 * Only three things differ between platforms: where the form is, whether it
 * paginates, and what the buttons say. Everything else is in apply.ts.
 *
 * The submit patterns exist so the driver can *recognise* the submit button
 * and stop. Nothing here ever clicks one. If a change to this file makes a
 * submit button reachable by `.click()`, that is the bug — see the note at the
 * top of apply.ts.
 */

/**
 * The dialog a *run* works in. The scan itself lives in `dialogs.ts`.
 *
 * Looser than `findApplicationForm` by one case, and that case is the last
 * page of every paginated flow: a review screen has no `input`, `select` or
 * `textarea` anywhere in it. It is a summary and a Submit button.
 *
 * Requiring controls therefore made the driver blind at exactly the step that
 * sends the application. `runApply` only accepts an advance when `flow.scope()`
 * comes back non-null, so clicking through to the review page looked like a
 * click the form had rejected: it waited the full six seconds and reported
 * "The form did not move on — something on this step needs your attention",
 * having in fact moved on correctly to the one page it needed to reach. The
 * application was filled, complete, one click from sent, and abandoned.
 *
 * So a dialog also counts when it carries the button that finishes or advances
 * an application. That is looser, and deliberately not extended to the panel's
 * passive coverage below — a dialog with a "Continue" button in it is not
 * evidence of an application form, it is evidence of a dialog.
 */
function applicationDialog(): HTMLElement | null {
  return findDialog(
    (el) => hasFormControls(el) || findButton(el, [...SUBMIT, ...ADVANCE]) !== null
  );
}

/**
 * A `<form>` that collects a file or an email address.
 *
 * The same test capture uses, and for the same reason: a newsletter signup in
 * the footer is a form too, and filling one is both useless and alarming.
 */
function applicationFormElement(): HTMLFormElement | null {
  return (
    [...document.querySelectorAll('form')].find(
      (candidate) =>
        candidate.querySelector('input[type="file"]') ||
        candidate.querySelector('input[type="email"]') ||
        candidate.querySelector('input[name*="resume" i], input[name*="email" i]')
    ) ?? null
  );
}

function isAtsPageWithoutFormElement(): boolean {
  const host = window.location.hostname.toLowerCase();
  const isAtsHost =
    host.includes('workday') ||
    host.includes('ashbyhq') ||
    host.includes('icims') ||
    host.includes('taleo') ||
    host.includes('successfactors') ||
    host.includes('smartrecruiters') ||
    host.includes('workable') ||
    host.includes('teamtailor') ||
    host.includes('bamboohr') ||
    host.includes('zohorecruit') ||
    host.includes('darwinbox') ||
    host.includes('keka') ||
    document.querySelector('[data-automation-id]') !== null;

  const controls = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
  if (controls.length >= 1 && isAtsHost) return true;

  if (controls.length >= 2) {
    const hasAdvanceBtn = findButton(document, [...SUBMIT, ...ADVANCE]) !== null;
    if (hasAdvanceBtn) return true;
  }

  return false;
}

/**
 * An actual application form, or null.
 *
 * Checks dialogs, form elements, and non-form ATS page containers (such as
 * Workday and Ashby which post over XHR without wrapping steps in a <form>).
 */
export function findApplicationForm(): ParentNode | null {
  return (
    findDialog(hasFormControls) ??
    applicationFormElement() ??
    (isAtsPageWithoutFormElement() ? document : null)
  );
}

/**
 * Where the apply driver works.
 *
 * Looser than `findApplicationForm`: some ATSs do not wrap the application in
 * a `<form>` at all — Workday and Ashby both post over XHR from a plain div —
 * so once a run has been asked for, the whole document is a reasonable scope.
 */
function dialogOrPage(): ParentNode | null {
  return (
    applicationDialog() ??
    applicationFormElement() ??
    (document.querySelector('input, select, textarea') ? document : null)
  );
}

const SUBMIT = [
  /^submit application$/i,
  /^submit$/i,
  /^send application$/i,
  /^apply$/i,
  /submit your application/i,
];

const ADVANCE = [
  /continue to next step/i,
  /review your application/i,
  /^next$/i,
  /^continue$/i,
  /^review$/i,
  /^save and continue$/i,
  /^next step$/i,
];

/** Single-page: Greenhouse, Lever, and most of the smaller ATSs. */
const singlePage: ApplyFlow = {
  name: 'single-page',
  scope: dialogOrPage,
  multiStep: false,
  advance: [],
  submit: SUBMIT,
};

/** Paginated: Workday, Ashby, iCIMS, Taleo, SuccessFactors. */
const paginated: ApplyFlow = {
  name: 'paginated',
  scope: dialogOrPage,
  multiStep: true,
  advance: ADVANCE,
  submit: SUBMIT,
};

/**
 * LinkedIn Easy Apply.
 *
 * Kept, and deliberately not wired to the panel. Auto-apply here was tried
 * against a live posting and did not work; the two bugs found in the attempt
 * were real and are fixed, but nothing has confirmed the flow end to end, and
 * a button that stalls silently is worse than no button. This stays so that
 * picking the work back up is a one-line change rather than a rewrite.
 */
export const linkedinFlow: ApplyFlow = {
  name: 'linkedin-easy-apply',
  // Includes the review step, which has no fields — only the button that
  // sends the application. See `applicationDialog`.
  scope: applicationDialog,
  async open() {
    const scope = document.querySelector('.jobs-search__job-details') ?? document;
    const trigger = findButton(scope, [/easy apply/i]);
    if (!trigger) return false;
    clickElement(trigger);
    return true;
  },
  multiStep: true,
  advance: ADVANCE,
  submit: SUBMIT,
};

/**
 * Which flow an ATS uses.
 *
 * Unknown platforms get the single-page flow: it fills, attaches and stops
 * without needing to recognise a next button, so the worst case on a form it
 * does not understand is that it does less, never that it clicks something
 * unexpected.
 */
const PAGINATED: AtsProvider[] = ['WORKDAY', 'ICIMS'];

export function flowFor(ats: AtsProvider | null, adapterVersion?: string): ApplyFlow | null {
  // LinkedIn is excluded on purpose — see linkedinFlow.
  if (ats === 'LINKEDIN') return null;
  if (!ats) return null;

  if (PAGINATED.includes(ats)) return paginated;

  // Version carries the real platform for everything mapped to GENERIC.
  const platform = adapterVersion?.split('@')[0] ?? '';
  if (['taleo', 'successfactors', 'workable'].includes(platform)) return paginated;
  if (platform === 'generic') return null;

  return singlePage;
}
