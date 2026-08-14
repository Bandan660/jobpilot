import type {
  CapturedJob,
  DuplicateCheckResponse,
  DuplicateMatch,
  CaptureResponse,
  Profile,
} from '@jobpilot/shared';
import { clampCapturedJob, matchSkills, type SkillMatch } from '@jobpilot/shared';

import { findAdapter, type JobAdapter } from './adapters/index.js';
import { easyApplyModal } from './adapters/linkedin.js';
import { runApply, type ApplyFlow } from './autofill/apply.js';
import { findApplicationForm, flowFor, linkedinFlow, isNonApplicationForm, getNaukriChatbotContainer } from './autofill/flows.js';
import { jobDescription } from './adapters/description.js';
import { extractFromJsonLd } from './adapters/jsonld.js';
import { autofill, fillComboboxes, previewCoverage } from './autofill/index.js';
import {
  CONFIRMATION_CHECK_MS,
  SPA_POLL_INTERVAL_MS,
  SPA_RENDER_TIMEOUT_MS,
} from './config.js';
import { send, type AutofillSummary, type Message, type StoredResumePayload } from './messages.js';
import { renderBanner, removeBanner } from './ui/banner.js';
import {
  renderPanel,
  removePanel,
  updateSession,
  resetPanelSession,
  panelIsOpen,
  openPanelForInput,
  showJobAnalyzing,
  type PanelJob,
  type PanelHandlers,
} from './ui/panel.js';
import { runSession, sessionBusy, cancelSession, resetSession } from './autoapply/session.js';

/**
 * Post-submit text that ATSs render on success. Used alongside each adapter's
 * confirmation selectors, because selector names change far more often than
 * this copy does.
 */
const CONFIRMATION_PHRASES = [
  'thank you for applying',
  'thanks for applying',
  'application submitted',
  'application was submitted',
  'your application was submitted',
  'application has been submitted',
  'application received',
  'we have received your application',
  'your application has been received',
  'successfully submitted',
  'application sent',
  'your application has been sent',
  'you will get an email confirmation at',
  'return to job search',
];

/**
 * Traces why the panel did or did not appear.
 *
 * Every early return in this file is a silent no-op from the user's side, and
 * "nothing happened" is the hardest report to act on. Prefixed so it is
 * greppable in a console that a job board has already filled with its own
 * logging.
 */
function debug(...args: unknown[]): void {
  console.info('[banapply]', ...args);
}

/** Per-page-load guard. The server is idempotent, this just avoids noise. */
let captured = false;
/**
 * Handled once per posting.
 *
 * The confirmation detector runs off a MutationObserver, so it re-fires on
 * every DOM change the confirmation screen makes — dozens of times while the
 * "application sent" panel animates in. Without this each one would try to
 * record the same application again.
 */
let submitRecorded = false;
let teardown: (() => void) | null = null;
let currentJob: CapturedJob | null = null;

/* ------------------------------ extraction ------------------------------ */

/**
 * JSON-LD first, adapter selectors only to fill gaps.
 *
 * Ordering matters: JSON-LD is structured and stable, selectors are brittle.
 * A selector must never overwrite a value the structured data already gave us.
 */
function buildJob(adapter: JobAdapter, url: URL): CapturedJob | null {
  const structured = extractFromJsonLd(document) ?? {};
  const scraped = adapter.extract(document, url);

  const pick = <K extends keyof CapturedJob>(key: K): CapturedJob[K] =>
    (structured[key] ?? scraped[key] ?? null) as CapturedJob[K];

  const title = pick('title');
  const company = pick('company');

  if (!title && !company) return null;

  if (
    title &&
    (/application (has been|was|is)?\s*submitted/i.test(title) ||
      /thank you for applying/i.test(title) ||
      /your application/i.test(title))
  ) {
    return null;
  }

  return {
    jobUrl: url.href,
    title,
    company,
    location: pick('location'),
    remote: pick('remote'),
    employmentType: pick('employmentType'),
    externalId: pick('externalId'),
    ats: adapter.ats,
    compRaw: pick('compRaw'),
    adapterVersion: adapter.version,
  };
}

/**
 * Is the DOM still showing the previous posting?
 *
 * On a single-page ATS the URL changes the instant a result is clicked and the
 * detail pane re-renders some frames later. A scrape taken in between reads
 * the *old* posting and looks entirely valid — right shape, populated fields,
 * nothing to distinguish it from a good read except that it belongs to a
 * different job than the URL now names.
 *
 * The adapters have declared `expectedExternalId` / `renderedExternalId` for
 * this since LinkedIn support landed, and nothing called them: the rewrite to
 * continuous tracking replaced the retry loop they were built for and left
 * them orphaned. The signature comparison that replaced it cannot cover this
 * case — the signature is built *from* the stale DOM, so it reads as a
 * perfectly stable value and gets captured.
 *
 * Only blocks when both ids are known and disagree. A null on either side
 * means "cannot tell", and treating that as stale would stop capture outright
 * on every posting that does not expose an id.
 */
function isStale(adapter: JobAdapter, url: URL): boolean {
  if (!adapter.expectedExternalId || !adapter.renderedExternalId) return false;

  const expected = adapter.expectedExternalId(url);
  const rendered = adapter.renderedExternalId(document);
  if (!expected || !rendered || expected === rendered) return false;

  // Not warn-worthy: mid-navigation is the normal reason to be here, and the
  // next poll will find the pane settled.
  debug('DOM still on', rendered, '- URL wants', expected, '- waiting');
  return true;
}

/* --------------------------- submit detection --------------------------- */

function pageLooksConfirmed(adapter: JobAdapter): boolean {
  if (adapter.confirmationSelectors.some((selector) => document.querySelector(selector))) {
    return true;
  }

  /*
   * An adapter that declares a scope and has none right now is not confirmed.
   * Falling back to the whole page here would defeat the point of declaring
   * one — see the note on confirmationScope.
   */
  let scope: Element | null | undefined = document.body;
  if (adapter.confirmationScope) {
    scope = adapter.confirmationScope();
    if (!scope) return false;
  }

  const text = (scope as HTMLElement)?.innerText?.toLowerCase() ?? '';
  return CONFIRMATION_PHRASES.some((phrase) => text.includes(phrase));
}

/**
 * A form is an application form if it collects a file or an email address.
 *
 * Without this check every newsletter signup and search box on the page would
 * register as an application -- a false positive is worse than a miss here,
 * because it silently pollutes the user's tracker.
 */
function looksLikeApplicationForm(form: HTMLFormElement): boolean {
  if (isNonApplicationForm(form)) return false;
  return Boolean(
    form.querySelector('input[type="file"]') ||
      form.querySelector('input[type="email"]') ||
      form.querySelector('input[name*="resume" i], input[name*="email" i]')
  );
}

/**
 * True when the row was written.
 *
 * `captureInFlight` closes a race the session made reachable: it records the
 * application itself, and the confirmation screen that submission produces
 * trips the detector a few hundred milliseconds later — while this request is
 * still open and `captured` is therefore still false. Without the flag that
 * is a second write for the same posting.
 */
let captureInFlight = false;

async function doCapture(job: CapturedJob, applied: boolean): Promise<boolean> {
  if (captured && applied) return true;
  if (applied) captureInFlight = true;

  /*
   * Clamped to the API's own limits before it goes. The server validates the
   * same numbers from the same constant, so anything over-length is a value
   * this scrape produced, not a request the user should be shown a 400 for.
   */
  const payload = clampCapturedJob(job);

  const message: Message = {
    type: 'CAPTURE',
    payload: { job: payload, applied, capturedAt: new Date().toISOString() },
  };

  const result = await send<CaptureResponse>(message);

  if (!result.ok) {
    // The banner carries the server's own message, which names the field when
    // it is a validation failure. Logged as well, with what was actually sent:
    // the banner is transient and a screenshot of it rarely includes the body.
    captureInFlight = false;
    console.warn('[banapply] capture failed:', result.error, payload);

    // Most likely not signed in. Prompt rather than failing silently, since the
    // user just did the thing we exist to record.
    renderBanner({
      tone: 'error',
      title: 'BanApply could not save this',
      body: result.error,
    });
    return false;
  }

  /*
   * Set only now, on a confirmed write. It used to be set before the request,
   * which meant a failed save latched the guard: every retry returned true
   * immediately without sending anything, and the application was lost with
   * the UI reporting success. That only became reachable once a human could
   * press the button again.
   */
  if (applied) {
    captured = true;
    captureInFlight = false;

    renderBanner({
      tone: 'success',
      title: 'Application tracked',
      body: `${result.data.application.title} at ${result.data.application.company.name}`,
    });
  }

  return true;
}

/**
 * Record a detected submission, without asking.
 *
 * There was a confirmation form here. It went, because it fired on top of an
 * application the session had already recorded a moment earlier: the run
 * submits, saves the row, and then the confirmation screen it produced trips
 * this detector — so the user got a dialog asking them to add something that
 * was already added.
 *
 * The old worry that motivated the form still stands: a detected submit is
 * evidence rather than proof, and `application_events` is append-only. What
 * changed is that the false-positive cost turned out to be smaller than the
 * cost of a dialog in front of every application, and a wrong row can be
 * corrected in the tracker. The guards below keep it to one write per posting.
 */
function recordDetectedSubmit(job: CapturedJob): void {
  if (submitRecorded || captured || captureInFlight) return;
  submitRecorded = true;

  debug('submit detected, recording:', job.title, '@', job.company);
  void doCapture(job, true);
}

function watchForSubmit(adapter: JobAdapter, getJob: () => CapturedJob | null): () => void {
  const onSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!looksLikeApplicationForm(form)) return;

    const job = getJob();
    if (job) recordDetectedSubmit(job);
  };

  // Capture phase: some ATSs call preventDefault and submit over XHR, which
  // would stop a bubble-phase listener from ever running.
  document.addEventListener('submit', onSubmit, true);

  /*
   * Throttled, because the check is expensive and the trigger is not rare.
   *
   * `pageLooksConfirmed` reads `innerText`, which forces the browser to lay
   * out the document to answer. Running that straight from the observer meant
   * one forced reflow per mutation, and LinkedIn mutates its feed and detail
   * pane continuously — hundreds of times a second while scrolling. The
   * confirmation screen does not appear and disappear inside 400ms, so the
   * only thing the unthrottled version bought was jank.
   */
  let checkTimer: number | undefined;

  const scheduleCheck = () => {
    if (captured || submitRecorded || checkTimer !== undefined) return;

    checkTimer = window.setTimeout(() => {
      checkTimer = undefined;
      if (captured || submitRecorded) return;
      if (!pageLooksConfirmed(adapter)) return;
      const job = getJob();
      if (job) recordDetectedSubmit(job);
    }, CONFIRMATION_CHECK_MS);
  };

  const observer = new MutationObserver(scheduleCheck);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  return () => {
    window.clearTimeout(checkTimer);
    document.removeEventListener('submit', onSubmit, true);
    observer.disconnect();
  };
}

/* ------------------------------ duplicates ------------------------------ */

async function checkDuplicates(job: CapturedJob): Promise<DuplicateMatch | null> {
  const result = await send<DuplicateCheckResponse>({
    type: 'CHECK_DUPLICATE',
    payload: { jobUrl: job.jobUrl, company: job.company, title: job.title },
  });

  // Silent on failure: this fires on page load and the user did not ask for
  // it, so a network error must not interrupt them.
  if (!result.ok || result.data.matches.length === 0) return null;
  return result.data.matches[0];
}

/* ------------------------------- side panel ------------------------------ */

/**
 * Is there an application here a session could drive?
 *
 * A flow, and either a form already on screen or a way to open one. On
 * LinkedIn the second half matters: the modal does not exist until the Easy
 * Apply button is pressed, so requiring a visible form would hide the action
 * on exactly the postings it is for.
 */
function isExternalJobPosting(): boolean {
  const host = window.location.hostname.toLowerCase();
  if (host.includes('naukri.com')) {
    if (getNaukriChatbotContainer() !== null) {
      return false;
    }
    const candidates = document.querySelectorAll(
      'button, a, div[role="button"], [class*="apply"], [class*="comp-site"]'
    );
    for (const el of candidates) {
      const text = (el.textContent ?? '').trim();
      if (
        /apply on (company|corporate|employer|external) (site|website)/i.test(text) ||
        /company site/i.test(text) ||
        /company website/i.test(text)
      ) {
        return true;
      }
      if (el.matches('[class*="company-site"], [class*="external-apply"], [class*="comp-site"]')) {
        return true;
      }
    }
  }
  return false;
}

function canRunSession(): boolean {
  if (isExternalJobPosting()) return false;
  const flow = applyFlow ?? (adapterAts === 'LINKEDIN' ? linkedinFlow : null);
  if (!flow) return false;
  if (flow.scope() !== null) return true;
  return adapterAts === 'LINKEDIN' && easyApplyAvailable();
}

/** LinkedIn's Easy Apply button on the posting itself. */
function easyApplyAvailable(): boolean {
  const pane = document.querySelector('.jobs-search__job-details') ?? document;
  return [...pane.querySelectorAll('button')].some((button) =>
    /easy apply/i.test(button.getAttribute('aria-label') ?? button.textContent ?? '')
  );
}

/**
 * Tell the user the run is waiting on them.
 *
 * The panel is not enough on its own. When the run stops for a question, the
 * application form is open and covering the middle of the screen — that is
 * what the user is looking at, and the side panel's list of questions is in
 * their peripheral vision at best. Worse, the panel may be collapsed to its
 * edge handle, in which case there is nothing to see at all and the run looks
 * like it simply stopped.
 *
 * Raised whether or not the panel is open — it is not skipped, whatever an
 * earlier version of this comment claimed. The panel is opened first and the
 * banner steps aside to clear it, which is what `rightPx` is for.
 */
function notifyIfWaiting(progress: {
  state: string;
  questions: { label: string }[];
  message: string;
}): void {
  if (progress.state !== 'needs-input') {
    // Any other state means the wait is over — clear a stale prompt rather
    // than leaving "answer this" up after it has been answered.
    if (progress.state === 'done' || progress.state === 'running') removeBanner();
    return;
  }

  /*
   * Open the panel first. The button the notice tells them to press lives in
   * it, and pointing at a collapsed handle is not much of an instruction.
   */
  openPanelForInput();

  const count = progress.questions.length;

  renderBanner({
    tone: 'warning',
    title:
      count === 1
        ? '1 question needs your attention'
        : `${count} questions need your attention`,
    body: 'Complete the required questions in the application form — jobpilot will automatically resume once filled.',
    // Clear of the panel, which is 372px and now open at the same edge.
    rightPx: panelIsOpen() ? 392 : 16,
  });
}



/**
 * Apply to the posting on screen, once.
 *
 * Start and continue are the same call by design: continuing after the user
 * has answered a question is just another pass over a form that is now more
 * complete than it was.
 */
function runSessionHere(): void {
  /*
   * LinkedIn gets its flow even when `flowFor` withholds it. That withholding
   * is about the *panel* not offering an unproven action automatically; a
   * session the user explicitly started is a different thing.
   */
  const flow = applyFlow ?? (adapterAts === 'LINKEDIN' ? linkedinFlow : null);
  if (!flow) {
    updateSession({ state: 'error', message: 'There is no application form on this page.' });
    return;
  }
  if (sessionBusy()) return;

  updateSession({ state: 'running', stage: 'fill', message: 'Starting…', questions: [] });

  void loadProfile({ fresh: true }).then((profile) => {
    if (!profile) {
      updateSession({ state: 'error', message: 'Could not load your profile.' });
      return;
    }

    void runSession({
      profile,
      flow,
      draftAnswers: false,
      readCurrentJob: () => currentJob,
      /*
       * Recorded as applied because it was: the page confirmed the submission
       * before this runs. It is the one write in the codebase that does not
       * wait for a human to confirm, and it is downstream of one who pressed
       * the button for this specific job.
       */
      onApplied: (job) => doCapture(job, true),
      onProgress: (progress) => {
        updateSession({
          state: progress.state,
          stage: progress.stage,
          message: progress.message,
          questions: progress.questions,
          answersToSave: progress.answersToSave,
          answersSaved: false,
          diagnostic: progress.diagnostic,
        });

        notifyIfWaiting(progress);
      },
    });
  });
}


/** Set once per page by init, so the panel knows which flow it is on. */
let adapterAts: string | null = null;
/** Null where there is no form here to drive. */
let applyFlow: ApplyFlow | null = null;

/** Lets the user stop a run between steps. */
let autoApplyCancelled = false;

/**
 * The skills comparison for the posting on screen.
 *
 * Computed once and reused. The panel repaints on every form change, and
 * re-scraping the description each time means an `innerText` read — which
 * forces a layout — several times a second. `undefined` is "not looked yet",
 * `null` is "no posting text here to compare".
 */
let matchCache: SkillMatch | null | undefined;

/**
 * The posting `matchCache` was computed from.
 *
 * A cache with no owner is what let one job's score appear under another's
 * title. `matchCache` was module-level and cleared by a *different* code path —
 * the tracker's `jobChanged` branch — so every route into `computeMatch` that
 * did not come through that branch, and every scrape that landed while the DOM
 * still belonged to the previous posting, was free to answer from it. Keyed
 * here, the cache can only ever be read back by the posting that filled it.
 *
 * It also stops the opposite failure: the key is the job identity, so a title
 * or company that merely re-renders (LinkedIn rewrites both while a pane
 * settles) no longer throws away a perfectly good comparison and re-runs the
 * "Analysing" card over the same description.
 */
let matchCacheKey: string | null = null;

/**
 * The body `matchCache` was computed from, as `descriptionFingerprint` sees it.
 *
 * The key above answers "whose score is this". This answers "was it computed
 * from the text that is on screen now", and the two are not the same question:
 * on a pane swap the new posting's identity arrives before its body, so a score
 * can be keyed correctly and still be drawn from the previous posting's words.
 * Without this the mistake was permanent — the cache was keyed only to the job,
 * so the real body arriving changed nothing.
 */
let matchCacheFingerprint: string | null = null;

/**
 * Failed description scrapes, so a client-rendered pane gets a second chance
 * without being re-read forever. `innerText` forces layout; unbounded retries
 * on a posting that genuinely has no description would do it every poll.
 */
let matchAttempts = 0;
const MAX_MATCH_ATTEMPTS = 10;

/**
 * The description the last comparison was computed from, and whose it was.
 *
 * The pane can carry the new posting's title and id while the body underneath
 * is still the previous one's — a scrape taken then is indistinguishable from a
 * good read except that its text is, byte for byte, the text already scored for
 * the job before. That is the one signal that survives whatever order LinkedIn
 * chooses to re-render in, so it is what this checks. Two postings with
 * genuinely identical bodies would score identically anyway, which is why
 * waiting on the coincidence costs nothing.
 */
let lastScoredDescription: { key: string; text: string } | null = null;

/**
 * When the posting on screen became the posting on screen.
 *
 * The wait above is bounded by time rather than by attempts because attempts
 * are not a clock here: a pane swap fires mutations in the hundreds, and an
 * attempt-based budget would be spent inside a second and leave the card
 * claiming the description could not be read.
 */
let matchKeySince = 0;
const STALE_BODY_GRACE_MS = 2500;

/**
 * `computeMatch` stood down and wants asking again.
 *
 * The tracker repaints only when its signature changes, and none of the things
 * in that signature move while a pane settles — the id, the title, the company
 * and the description bit all read the same before and after. So a deferred
 * comparison would never be retried and the card would spin for the life of
 * the posting.
 *
 * It is a flag rather than "retry whenever the match is unresolved" on purpose.
 * Signed out, `computeMatch` never runs, so the match is unresolved forever —
 * and that version of this rebuilt the panel every 800ms underneath the
 * sign-in form the panel itself carries, which is unusable.
 */
let matchDeferred = false;

/**
 * Identity of the posting, as far as anything here can tell.
 *
 * Deliberately not `externalId` alone: on LinkedIn's split view `externalId`
 * comes from JSON-LD first, and that block belongs to whichever posting the
 * document was served for — it does not change as you click through the list.
 * Title and company do.
 */
function jobKeyOf(job: CapturedJob): string {
  return [job.externalId, job.title, job.company].join('|');
}

/**
 * Has the detail pane settled on the posting the URL currently names?
 *
 * The same predicate as `isStale`, asked again at the description scrape. That
 * is not redundant: the tracker checks it once at the top of `evaluate`, and
 * then a duplicate-check request, a service-worker round trip and a profile
 * load all happen before anything reads the description. A click on the next
 * posting lands comfortably inside that window, and the scrape it produces is a
 * fully valid read of the wrong job — right shape, real text, nothing to mark
 * it as belonging to a posting nobody is looking at any more.
 *
 * Deliberately *not* compared against `job.externalId`. That field prefers
 * JSON-LD, and LinkedIn's JSON-LD block belongs to whichever posting the
 * document was served for — it does not change as you click through the list.
 * Comparing against it would read as permanently stale on every posting after
 * the first and leave the card spinning forever. Both values here are read
 * live, one from the URL and one from the DOM, which is the whole point of the
 * pair.
 *
 * `null` is "cannot tell": most adapters do not implement these hooks, and
 * treating that as stale would switch the comparison off everywhere but here.
 */
function paneSettled(): boolean | null {
  const url = new URL(window.location.href);
  const adapter = findAdapter(url);
  if (!adapter?.expectedExternalId || !adapter.renderedExternalId) return null;

  const expected = adapter.expectedExternalId(url);
  const rendered = adapter.renderedExternalId(document);
  if (!expected || !rendered) return null;
  return expected === rendered;
}

async function computeMatch(job: CapturedJob): Promise<SkillMatch | null> {
  const key = jobKeyOf(job);

  const fingerprint = descriptionFingerprint();

  if (key !== matchCacheKey) {
    matchCacheKey = key;
    matchCache = undefined;
    matchCacheFingerprint = null;
    matchAttempts = 0;
    matchKeySince = Date.now();
  }

  /*
   * Same posting, different body: the pane has finished swapping and what was
   * scored a moment ago belonged to the posting before this one. Score it
   * again. The attempt count resets with it, because the reason the earlier
   * reads failed — a body that had not rendered yet — has just gone away.
   *
   * Only a *changed* fingerprint does this, never an absent one. A pane that
   * momentarily empties itself mid-swap would otherwise throw away a good
   * comparison and put the "Analysing" card back over a posting that was
   * already scored.
   *
   * The attempt reset is narrower still: it needs a body we actually scored to
   * have been replaced. Resetting whenever a fingerprint merely exists would
   * uncap the retry budget on the one posting that needs it capped — a body
   * long enough to fingerprint but not long enough for `jobDescription` to
   * accept would never reach ten attempts, and "Analysing" would spin for the
   * life of the posting instead of standing down.
   */
  if (fingerprint && fingerprint !== matchCacheFingerprint) {
    if (matchCacheFingerprint !== null) matchAttempts = 0;
    matchCache = undefined;
    matchCacheFingerprint = null;
  }

  matchDeferred = false;
  if (matchCache !== undefined) return matchCache;

  /*
   * Not counted as an attempt — see `matchKeySince`. This is a pane mid-swap,
   * which settles on its own within a poll or two.
   */
  if (paneSettled() === false) {
    matchDeferred = true;
    return null;
  }

  const url = new URL(window.location.href);
  const adapter = findAdapter(url);
  if (adapter?.renderedExternalId && job.externalId) {
    const renderedId = adapter.renderedExternalId(document);
    if (renderedId && renderedId !== job.externalId) {
      matchDeferred = true;
      return null;
    }
  }

  const description = pageDescription();
  if (!description) {
    /*
     * NOT cached, for the same reason the profile below is not.
     */
    matchAttempts += 1;
    if (matchAttempts >= MAX_MATCH_ATTEMPTS) matchCache = null;
    return null;
  }

  /*
   * The body still belongs to the posting before this one.
   * Compare both exact text and prefix text to reliably catch pane swaps on LinkedIn.
   */
  const isPreviousText =
    lastScoredDescription &&
    lastScoredDescription.key !== key &&
    (lastScoredDescription.text === description ||
      (lastScoredDescription.text.length > 80 &&
        description.length > 80 &&
        description.slice(0, 150) === lastScoredDescription.text.slice(0, 150)));

  if (isPreviousText && Date.now() - matchKeySince < STALE_BODY_GRACE_MS) {
    matchDeferred = true;
    return null;
  }

  const profile = await loadProfile();
  if (!profile) return null;

  if (matchCacheKey !== key || paneSettled() === false) {
    matchDeferred = true;
    return null;
  }

  /*
   * The body must not have moved while the profile was loading.
   *
   * `description` was read before that await, so a pane that finished swapping
   * inside it leaves this holding the previous posting's words. Stamping the
   * *current* fingerprint here would be worse than not stamping at all: it
   * would mark a score computed from the old body as belonging to the new one,
   * and the correction above — the whole point of the fingerprint — would never
   * fire again for this posting. Defer instead; the next pass reads the body
   * that is actually on screen.
   */
  if (descriptionFingerprint() !== fingerprint) {
    matchDeferred = true;
    return null;
  }

  lastScoredDescription = { key, text: description };
  matchCacheFingerprint = fingerprint || null;
  matchCache = matchSkills(description, profile);
  return matchCache;
}

/**
 * The posting's body text, or null when there is not enough of it.
 *
 * Not cached: the pane's content changes with the posting, and a stale
 * description would be compared against the wrong job.
 */
function pageDescription(): string | null {
  const url = new URL(window.location.href);
  const adapter = findAdapter(url);
  return adapter ? jobDescription(document, adapter) : null;
}

/**
 * Which description is on screen — cheaply enough to ask every poll.
 *
 * Part of the tracking signature, and it has to be, because nothing else in
 * that signature moves when a description arrives: the id, the title, the
 * company and the Easy Apply field count are all identical before and after
 * the pane renders. Without this the repaint that would retry the scrape never
 * happens, and a posting whose body loaded late stays uncompared.
 *
 * WHY IT IDENTIFIES THE BODY RATHER THAN JUST COUNTING IT
 *
 * This used to answer "has *a* description turned up", one bit, and a bit that
 * has already flipped can never flip again. That is what left the same skills
 * and the same score on screen after clicking the next posting: LinkedIn swaps
 * the detail pane in place, so for a few hundred milliseconds the new posting's
 * title sits above the old posting's body. Score inside that window — which
 * `STALE_BODY_GRACE_MS` bounds but does not prevent — and the wrong result is
 * cached under the new posting's key, with nothing left that could ever notice:
 * the bit was already 'd' before the real body arrived, so no repaint, and a
 * repaint would have returned the cache anyway.
 *
 * A fingerprint of the text moves when the text moves. The pane finishing its
 * swap now changes the signature, which forces the repaint, and `computeMatch`
 * compares it against the fingerprint of whatever it scored last — so a score
 * taken from a stale body corrects itself as soon as the real one lands.
 *
 * `textContent`, not `innerText`: this runs on every poll and must not force a
 * layout. The hash is over the first 400 characters, which is enough to tell
 * two postings apart and short enough to be free. The real read stays in
 * `jobDescription`, which runs once per posting.
 */
function descriptionFingerprint(): string {
  const adapter = findAdapter(new URL(window.location.href));
  if (!adapter) return '';

  for (const selector of adapter.descriptionSelectors ?? []) {
    const text = document.querySelector(selector)?.textContent?.trim() ?? '';
    if (text.length >= 50) return `${text.length}:${hash(text.slice(0, 400))}`;
  }

  return '';
}

/** djb2, over at most 400 characters. Not a checksum — just a cheap identity. */
function hash(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return h;
}

/**
 * Why the description could not be read, in one line the user can screenshot.
 *
 * LinkedIn rotates its class names, so "the scrape found nothing" is a report
 * that will recur for the life of this product — and diagnosing it has twice
 * meant asking someone to paste a console one-liner from a page only they can
 * see. The panel already knows the answer at the moment it fails; printing it
 * costs one line and turns every future report into a screenshot that names
 * the container to add.
 *
 * Computed only on failure, so the querySelectorAll cost never lands on the
 * normal path.
 */
function describeDescriptionMiss(): string[] {
  const adapter = findAdapter(new URL(window.location.href));
  const probes = [
    ...(adapter?.descriptionSelectors ?? []),
    'main',
    'article',
    '[class*="description"]',
  ];

  return probes.map((selector) => {
    const el = document.querySelector(selector);
    const length = el?.textContent?.trim().length ?? 0;
    return `${selector} ${el ? length : '—'}`;
  });
}


let currentDuplicate: DuplicateMatch | null = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.authToken || changes.userEmail)) {
    if (currentJob) {
      void maybeShowPanel(currentJob, currentDuplicate);
    }
  }
});

/**
 * Mount the launcher once there is something worth acting on.
 */
async function maybeShowPanel(job: CapturedJob, duplicate: DuplicateMatch | null): Promise<void> {
  /*
   * Every call is a full repaint from scratch, and there is no guarantee they
   * finish in the order they started: each one awaits a service-worker message,
   * a profile load and the comparison, and those take different amounts of time
   * depending on what is cached. Two in flight across a job switch — which is
   * the normal case, since the storage listener and the tracker both paint —
   * and the *older* one can be the one that lands, putting the previous
   * posting's panel back on top of the current one's.
   *
   * Last caller wins. Anything overtaken drops its paint on the floor.
   */
  const token = ++paintToken;

  currentJob = job;
  currentDuplicate = duplicate;

  const session = await send<{ authenticated: boolean; email: string | null }>({
    type: 'GET_SESSION',
  });
  const authenticated = session.ok && session.data.authenticated;

  /*
   * Signed out still renders: the panel carries the sign-in form itself. The
   * profile and coverage lookups are skipped because both need a token, so
   * they would only produce a 401 and clear the session again.
   */
  const profile = authenticated ? await loadProfile() : null;
  if (authenticated && !profile) return debug('could not load your profile');

  /*
   * Scoped to an actual application form — a dialog, or a form that collects a
   * file or an email. Never the whole document.
   */
  const formScope = findApplicationForm();
  const coverage =
    profile && formScope ? previewCoverage(profile, formScope) : { fillable: 0, total: 0 };
  const isExternalJob = isExternalJobPosting();

  debug(
    'coverage:',
    formScope ? `${coverage.fillable} of ${coverage.total}` : 'no application form on this page'
  );

  const validDuplicate =
    duplicate &&
    !/application (has been|was|is)?\s*submitted/i.test(duplicate.title) &&
    !/smartapply/i.test(duplicate.companyName)
      ? duplicate
      : null;

  const buildJobState = (matchVal: SkillMatch | null, isAnalyzing: boolean): PanelJob => ({
    job,
    coverage,
    email: session.ok && session.data.email ? session.data.email : (profile?.email ?? null),
    profile,
    duplicate: validDuplicate,
    authenticated,
    canAutoApply:
      !isExternalJob &&
      applyFlow !== null &&
      (applyFlow.open !== undefined || applyFlow.scope() !== null),
    hasForm: formScope !== null,
    canApply: canRunSession(),
    match: matchVal,
    isAnalyzingMatch: isAnalyzing,
    isExternalJob,
    // Only when there is nothing to show and the user is owed a reason.
    matchDiagnostic: matchVal === null && authenticated ? describeDescriptionMiss() : undefined,
  });

  const handlers: PanelHandlers = {
    onFill: async (overwrite) => {
      const summary = await runAutofill(overwrite, {
        silent: true,
        root: easyApplyModal() ?? undefined,
      });
      return { filled: summary.filled, unanswered: summary.unanswered.length };
    },
    onSave: () => doCapture(job, false),
    onSignOut: () => {
      void send({ type: 'LOGOUT' }).then(() => {
        removePanel();
        void maybeShowPanel(job, null);
      });
    },
    onCancelAutoApply: () => {
      autoApplyCancelled = true;
    },

    /* --------------------------- apply session --------------------------- */

    onStartSession: () => runSessionHere(),
    onContinueSession: () => runSessionHere(),
    onCancelSession: () => cancelSession(),

    onSaveAnswers: (answers) => {
      updateSession({ savingAnswers: true });
      void send<{ saved: number }>({ type: 'SAVE_ANSWERS', payload: { answers } }).then(
        (result) => {
          if (!result.ok) {
            updateSession({ savingAnswers: false, message: result.error, state: 'error' });
            return;
          }
          invalidateProfile();
          updateSession({ savingAnswers: false, answersSaved: true });
        }
      );
    },

    onAuth: async (mode, email, password) => {
      const result = await send<{ authenticated: boolean; error?: string }>({
        type: mode === 'login' ? 'LOGIN' : 'SIGNUP',
        payload: { email, password },
      });
      if (result.ok && result.data.authenticated) {
        void maybeShowPanel(job, duplicate);
        return null;
      }
      return result.ok ? result.data.error ?? 'Could not sign in' : result.error;
    },

    onAutoApply: async (report, draftAnswers) => {
      autoApplyCancelled = false;

      const flow = applyFlow;
      if (!flow) {
        report('There is no application form on this page.', 'blocked');
        return;
      }

      const current = await loadProfile({ fresh: true });
      if (!current) {
        report('Could not load your profile.', 'blocked');
        return;
      }

      const outcome = await runApply({
        profile: current,
        flow,
        draftAnswers,
        job: { title: job.title, company: job.company, jobUrl: job.jobUrl },
        isCancelled: () => autoApplyCancelled,
        onProgress: (progress) => {
          const tone =
            progress.status === 'ready'
              ? 'ready'
              : progress.status === 'blocked' || progress.status === 'error'
                ? 'blocked'
                : 'busy';
          report(progress.message, tone);
        },
      });

      if (outcome.blockers?.length) {
        const named = outcome.blockers
          .map((blocker) => (blocker.kind === 'invalid' ? `⚠ ${blocker.label}` : blocker.label))
          .join(' · ');
        report(`${outcome.message} ${named}`, 'blocked');
      }

      if (outcome.status === 'ready') {
        await doCapture(job, false);
      }
    },
  };

  let match: SkillMatch | null = null;
  if (authenticated) {
    match = await computeMatch(job);
  } else {
    // Nothing is pending when there is nobody to compare against, and a flag
    // left set from before a sign-out would repaint the panel — and the
    // sign-in form inside it — every 800ms.
    matchDeferred = false;
  }

  const isAnalyzing = authenticated && match === null && matchAttempts < MAX_MATCH_ATTEMPTS;

  if (token !== paintToken) return;
  await renderPanel(buildJobState(match, isAnalyzing), handlers);
}

/** Bumped by every `maybeShowPanel`; see the note there. */
let paintToken = 0;

/* --------------------------------- init --------------------------------- */

/**
 * Watches the page and keeps the panel pointed at whatever is on screen.
 *
 * This replaced a one-shot init that waited for a job, drew the panel once and
 * stopped. That is fine where the form is the page. On LinkedIn the detail
 * pane is swapped repeatedly under a URL that has already changed, so a single
 * read lands on whichever posting happened to be rendered at that instant —
 * usually the previous one.
 *
 * Rather than trying to predict when the pane has settled, everything is
 * re-read on every mutation and every URL poll, and the panel is redrawn only
 * when the result actually differs. A signature comparison makes that cheap
 * enough to run continuously.
 */
function startTracking(adapter: JobAdapter): () => void {
  let lastSignature = '';
  let lastJobKey = '';
  let timer: number | undefined;
  let running = false;

  const evaluate = async () => {
    if (running) return;

    /*
     * A run owns the page while it lasts.
     *
     * It changes the visible posting every few seconds, and each change would
     * otherwise fire a duplicate-check request and a full panel repaint —
     * dozens of API calls across a run, and a panel rebuilt underneath the
     * controls the user is trying to press. The run paints its own subtree
     * directly, so standing back costs nothing.
     */
    if (sessionBusy()) return;

    running = true;

    try {
      const url = new URL(window.location.href);

      if (!adapter.isJobPage(url)) {
        if (lastSignature) {
          debug('left the posting');
          lastSignature = '';
          lastJobKey = '';
          currentJob = null;
          removePanel();
        }
        return;
      }

      if (isStale(adapter, url)) return;

      const job = buildJob(adapter, url);
      if (!job) return;

      /*
       * Field count stands in for which Easy Apply step is showing. It changes
       * exactly when the form does, and costs one querySelectorAll.
       */
      const modal = easyApplyModal();
      const fields = modal ? modal.querySelectorAll('input, select, textarea').length : 0;

      const jobKey = jobKeyOf(job);
      // The description bit flips once, when a client-rendered pane finishes.
      // That repaint is what lets a first failed scrape try again.
      /*
       * Naukri's drawer has to be in here too. `fields` counts the LinkedIn
       * Easy Apply modal and is zero on Naukri whatever happens, so opening
       * the chatbot moved nothing in this signature — and the panel only
       * repaints when the signature moves. The panel steps aside from that
       * drawer during its paint, so without this it would step aside only if
       * something unrelated happened to repaint it first. Cheap off Naukri:
       * the detector returns null on the hostname check before touching the
       * DOM.
       */
      const drawerOpen = getNaukriChatbotContainer() !== null;

      const signature = [
        jobKey,
        fields,
        drawerOpen ? 'drawer' : '-',
        descriptionFingerprint() || '-',
      ].join('|');
      // `matchDeferred` is the one reason to repaint an unchanged signature:
      // the comparison asked to be tried again and nothing in the signature
      // will ever move to make that happen. See the flag's own note.
      if (signature === lastSignature && !matchDeferred) return;

      const jobChanged = jobKey !== lastJobKey;
      lastSignature = signature;
      lastJobKey = jobKey;
      currentJob = job;

      if (jobChanged) {
        captured = false;
        submitRecorded = false;
        debug('job:', job.title, '@', job.company);

        /*
         * Synchronous, and it has to be. The previous posting's score is on
         * screen right now; every other route to replacing it goes through a
         * service-worker message first. `computeMatch` owns invalidating its
         * own cache from here on — clearing it here as well is what made a
         * pane that merely re-rendered its title re-run the comparison.
         */
        showJobAnalyzing(job);
      }

      /*
       * Only re-check duplicates when the posting itself changed. Advancing a
       * step in the modal is not a reason to hit the API again.
       */
      const duplicate = jobChanged ? await checkDuplicates(job) : lastDuplicate;
      lastDuplicate = duplicate;

      await maybeShowPanel(job, duplicate);
    } finally {
      running = false;
    }
  };

  /*
   * Debounced, but with a ceiling on how long the debounce can hold it off.
   *
   * A plain trailing debounce is starvable, and a LinkedIn pane swap starves
   * it: mutations arrive faster than 300ms apart for as long as the new
   * posting is rendering, and each one pushed the timer out again, so the
   * evaluate that would notice the new job never ran. What actually noticed it
   * was the 800ms backstop poll — which is why the panel took the better part
   * of a second to catch up with a click, and why moving the reset around
   * inside `evaluate` never made it feel any quicker.
   *
   * Now the timer is only ever pushed out to at most `MUTATION_MAX_WAIT_MS`
   * from the last run. Bursts still coalesce; they can no longer postpone
   * indefinitely.
   */
  let lastRun = 0;
  const MUTATION_MAX_WAIT_MS = 300;

  const schedule = () => {
    window.clearTimeout(timer);
    const elapsed = Date.now() - lastRun;
    const wait = elapsed >= MUTATION_MAX_WAIT_MS ? 0 : MUTATION_MAX_WAIT_MS - elapsed;
    timer = window.setTimeout(() => {
      lastRun = Date.now();
      void evaluate();
    }, wait);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Backstop for anything the observer misses, and for the very first read.
  const poll = window.setInterval(() => void evaluate(), 800);
  void evaluate();

  return () => {
    window.clearTimeout(timer);
    window.clearInterval(poll);
    observer.disconnect();
  };
}

/** Remembered so a step change does not drop the duplicate warning. */
let lastDuplicate: DuplicateMatch | null = null;

async function init(): Promise<void> {
  teardown?.();
  teardown = null;
  removeBanner();

  /*
   * The session belongs to one posting. Left alone, moving to the next job
   * would inherit the previous one's "Applied — added to your tracker", or
   * worse its list of outstanding questions — so continuing would answer the
   * old job's questions against the new job's form.
   */
  resetSession();
  resetPanelSession();

  /*
   * The comparison is NOT cleared here, and that is a change.
   *
   * `init` runs on every URL change, and LinkedIn rewrites its own query
   * string — tracking parameters, pane state — while you sit on one posting.
   * Each of those wiped a perfectly good comparison and sent the card back to
   * "Analysing" over a description that had not moved, which is a good part of
   * what "it analyses again" was. `computeMatch` is keyed to the posting now,
   * so a genuine change invalidates itself and a spurious one costs nothing.
   */
  matchDeferred = false;

  captured = false;
  submitRecorded = false;
  currentJob = null;
  lastDuplicate = null;

  const url = new URL(window.location.href);
  const adapter = findAdapter(url);
  if (!adapter) return debug('no adapter for', url.hostname);

  adapterAts = adapter.ats;
  applyFlow = flowFor(adapter.ats, adapter.version);
  debug('adapter:', adapter.version, '· apply flow:', applyFlow?.name ?? 'none');

  /*
   * Landing straight on a confirmation means the ATS redirected after a submit
   * that happened before this script loaded. Same rule as a submit detected
   * live: ask, do not write. This path is the least certain of the three —
   * a confirmation page reached by back-button or a shared link looks
   * identical to one reached by submitting.
   */
  if (adapter.isJobPage(url) && pageLooksConfirmed(adapter)) {
    const job = buildJob(adapter, url);
    if (job) recordDetectedSubmit(job);
  }

  const stopTracking = startTracking(adapter);
  const stopSubmit = watchForSubmit(adapter, () => currentJob);

  teardown = () => {
    stopTracking();
    stopSubmit();
  };
}

/**
 * SPA route changes do not reload the content script, so History API calls are
 * patched to re-run init. Ashby in particular navigates board -> posting
 * entirely client-side.
 */

/**
 * Which posting a URL names, for deciding whether a URL change is a job change.
 *
 * Falls back to the whole href where the adapter has no id hook, because on
 * those platforms a URL change *is* a different posting — Ashby navigates
 * board to posting client-side and nothing else marks it. LinkedIn does have
 * the hook, and needs it: it rewrites its own query string for tracking and
 * pane state, and treating that as a job change would blank the card while you
 * sit on one posting.
 */
function urlJobIdentity(url: URL): string {
  const adapter = findAdapter(url);
  return adapter?.expectedExternalId?.(url) ?? url.href;
}

function watchNavigation(): void {
  let lastUrl = window.location.href;
  let lastIdentity = urlJobIdentity(new URL(lastUrl));

  const onChange = () => {
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;

    /*
     * Before `init`, and this is the whole trick.
     *
     * The URL changes the instant a posting is clicked. Everything that learns
     * *which* posting has to wait for the pane to render, and the tracker that
     * does that reading is driven by a debounced MutationObserver and an 800ms
     * poll — so on a real job switch the previous posting's score stayed on
     * screen for a second or more. Every attempt to fix this so far moved the
     * reset around inside that pipeline, which cannot be early enough: the
     * pipeline is the thing that is late.
     *
     * A URL comparison needs nothing from the DOM, so it can run here, at
     * click time. Blanking the card costs nothing if the read turns out to be
     * the same posting — the tracker paints over this within a frame or two
     * either way.
     */
    const url = new URL(window.location.href);
    const identity = urlJobIdentity(url);
    const movedPosting = identity !== lastIdentity;
    lastIdentity = identity;

    if (movedPosting && findAdapter(url)?.isJobPage(url)) showJobAnalyzing();

    void init();
  };

  /*
   * Patching history is necessary but not sufficient. LinkedIn changes the
   * visible posting in ways that do not always reach these hooks — a framework
   * that captured pushState before this script ran still calls the original —
   * so the URL is also polled.
   *
   * 150ms rather than 600: this poll is what actually catches a LinkedIn job
   * switch, since LinkedIn is precisely the site whose pushState never reaches
   * the patch above, and at 600ms it was contributing over half a second of
   * stale score on its own. A string compare is not worth pacing.
   */
  setInterval(onChange, 150);

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      queueMicrotask(onChange);
      return result;
    };
  }

  window.addEventListener('popstate', onChange);
}

/* -------------------------------- autofill ------------------------------- */

/**
 * The profile, fetched once per page rather than once per repaint.
 *
 * `maybeShowPanel` calls this every time it paints, and it paints whenever the
 * tracking signature changes — which on LinkedIn is whenever the detail pane
 * re-renders, several times per posting. Each of those was a real
 * `GET /api/profile` round trip for a value that cannot have changed in the
 * 300ms since the last one.
 *
 * `fresh` bypasses the cache for the two paths where staleness would actually
 * cost something: filling a form and running assisted apply both write the
 * profile into someone's application, so they re-read it at the moment of use.
 * The passive coverage count does not need that.
 *
 * IT EXPIRES, AND IT HAS TO
 *
 * "Once per page" is once per *tab*, and a job tab lives for hours. Add a skill
 * on the website and the profile in the database changes; the copy this tab
 * took at load does not, and every score drawn afterwards is against the old
 * one. That is not a hypothetical — it showed up as a posting reporting
 * "JavaScript, HTML, CSS — not in your profile" against a profile listing all
 * three, and nothing short of a reload would clear it, because the only
 * invalidation was the saved-answers write.
 *
 * So the cache is a short one, not a permanent one, and the comparison is
 * always against the profile as the database has it.
 */
const PROFILE_TTL_MS = 60_000;

let profileCache: Profile | null | undefined;
let profileCachedAt = 0;
let profileInFlight: Promise<Profile | null> | null = null;

/**
 * The cached profile, if there is one and it is young enough to still be what
 * the database holds. `undefined` means "ask again" — either nothing is
 * cached, or what is cached has aged out.
 */
function currentProfile(): Profile | null | undefined {
  if (profileCache === undefined) return undefined;
  return Date.now() - profileCachedAt < PROFILE_TTL_MS ? profileCache : undefined;
}

/**
 * The profile in the database changed — drop what this tab is holding.
 *
 * The match goes with it. `matchCache` is keyed to the posting, not to the
 * profile, so without this the card keeps showing a score computed against the
 * skills list the user just edited, for as long as they stay on the posting.
 * `matchDeferred` is what actually gets it back on screen: the tracking
 * signature is built from the page and nothing in it moves when a profile
 * changes, so the repaint has to be asked for.
 */
function invalidateProfile(): void {
  profileCache = undefined;
  profileCachedAt = 0;
  matchCache = undefined;
  matchDeferred = true;
}

async function loadProfile(options: { fresh?: boolean } = {}): Promise<Profile | null> {
  if (!options.fresh) {
    const cached = currentProfile();
    if (cached !== undefined) return cached;
  }

  /*
   * Share one request between concurrent callers. Without this the first paint
   * fires GET_PROFILE, and every paint before it resolves fires another —
   * the cache only helps once something has come back.
   */
  if (!options.fresh && profileInFlight) return profileInFlight;

  const request = send<{ profile: Profile }>({ type: 'GET_PROFILE' }).then((result) => {
    const profile = result.ok ? result.data.profile : null;
    // A failed read is not cached: it is usually a signed-out state that the
    // user is about to fix from the panel, and caching null would leave the
    // panel insisting there is no profile until the page reloads.
    if (result.ok) {
      profileCache = profile;
      profileCachedAt = Date.now();
    }
    return profile;
  });

  if (!options.fresh) profileInFlight = request;

  try {
    return await request;
  } finally {
    if (!options.fresh) profileInFlight = null;
  }
}

/*
 * Coming back to the tab is the moment the profile is most likely to have
 * changed: editing it means leaving for the dashboard and returning, and the
 * TTL alone would leave the old score up for up to a minute of that. Cheaper
 * than polling and tied to the only thing that actually signals an edit.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') invalidateProfile();
});
window.addEventListener('focus', () => invalidateProfile());

/**
 * Fill the application form from the saved profile.
 *
 * Never submits. Autofill puts values in front of the user for review — the
 * decision to send an application stays a deliberate click, which is also what
 * keeps this from becoming a mass-application tool.
 */
async function runAutofill(
  overwrite: boolean,
  options: { silent?: boolean; root?: ParentNode } = {}
): Promise<AutofillSummary> {
  const profile = await loadProfile({ fresh: true });
  if (!profile) {
    renderBanner({
      tone: 'error',
      title: 'Could not autofill',
      body: 'Sign in from the jobpilot popup, then try again.',
    });
    return { filled: 0, skipped: 0, unanswered: [] };
  }

  const result = autofill(profile, { overwrite, root: options.root });

  // Typeaheads need their own pass — see `fillComboboxes`. Run here too, so
  // the panel's Fill leaves the form in the same state a run would.
  const combos = await fillComboboxes(profile, { overwrite, root: options.root });
  result.filled += combos.filled;

  const parts = [`${result.filled} field${result.filled === 1 ? '' : 's'} filled`];
  if (result.skipped > 0) parts.push(`${result.skipped} already had a value`);

  if (options.silent) {
    return { filled: result.filled, skipped: result.skipped, unanswered: result.unanswered };
  }

  renderBanner({
    tone: result.filled > 0 ? 'success' : 'info',
    title: result.filled > 0 ? 'Form filled — check it before you submit' : 'Nothing to fill here',
    body:
      result.unanswered.length > 0
        ? `${parts.join(' · ')}. ${result.unanswered.length} question${
            result.unanswered.length === 1 ? '' : 's'
          } still need you.`
        : parts.join(' · '),
    timeoutMs: 8000,
  });

  return { filled: result.filled, skipped: result.skipped, unanswered: result.unanswered };
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message?.type === 'GET_PAGE_JOB') {
    sendResponse({ ok: true, data: currentJob });
    return false;
  }

  if (message?.type === 'AUTOFILL_PAGE') {
    void runAutofill(message.payload.overwrite).then((data) => sendResponse({ ok: true, data }));
    return true; // async response
  }

  if (message?.type === 'GET_FORM_COVERAGE') {
    void loadProfile().then((profile) => {
      sendResponse({
        ok: true,
        data: profile ? previewCoverage(profile) : { fillable: 0, total: 0 },
      });
    });
    return true;
  }

  return false;
});

/*
 * Announce ourselves on jobpilot's own pages.
 *
 * The site shows an "install the extension" banner, and showing it to someone
 * who already installed it is exactly the annoyance that gets banners ignored.
 * A data attribute is the simplest channel that needs no extension id, no
 * externally_connectable entry, and no message round-trip — the page just
 * looks for it after mount.
 *
 * Set before anything else so it lands even if adapter matching bails.
 */
function announce(): void {
  if (!onOwnSite()) return;
  document.documentElement.dataset.banapplyExtension =
    chrome.runtime.getManifest().version;
  document.documentElement.dataset.jobpilotExtension =
    chrome.runtime.getManifest().version;
}

/**
 * jobpilot's own site — the only origin allowed to hand over a session.
 *
 * EXACT HOSTS, NOT SUFFIXES
 *
 * This used to end in `|pages\.dev|localhost)$` with a `(^|\.)` prefix, which
 * matched **every** `*.pages.dev` hostname on the internet. Anyone can deploy a
 * free Cloudflare Pages site, and this predicate is the only thing gating
 * `listenForWebSession` — so such a page could have posted a token of its own
 * choosing and had the extension adopt it. The victim's captures, saved
 * answers and applications would then be written into the attacker's account
 * while their own tracker quietly recorded nothing.
 *
 * It was not reachable — `content_scripts.matches` in the manifest does not
 * include those hosts, so this script never ran there — but the gap was one
 * manifest edit away from being live, and a preview host is exactly the kind of
 * thing that gets added to that list. `env.ts` in the backend documents the
 * same trap for CORS and gets it right; this is that lesson applied here.
 *
 * localhost stays for development, and is now the whole hostname rather than
 * any suffix ending in it.
 */
const OWN_HOSTS = new Set([
  'banapply.com',
  'www.banapply.com',
  'jobpilot-3lg.pages.dev',
  'localhost',
  '127.0.0.1',
]);

function onOwnSite(): boolean {
  return OWN_HOSTS.has(window.location.hostname.toLowerCase());
}

/**
 * Take the session the website hands over after signing in there.
 */
function listenForWebSession(): void {
  if (!onOwnSite()) return;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data as
      | { source?: unknown; type?: unknown; token?: unknown; email?: unknown }
      | null;

    if (!data || data.source !== 'banapply-web') return;

    if (data.type === 'SESSION' && typeof data.token === 'string' && data.token) {
      void send({
        type: 'ADOPT_SESSION',
        payload: { token: data.token, email: typeof data.email === 'string' ? data.email : '' },
      });
    } else if (data.type === 'LOGOUT') {
      void send({ type: 'LOGOUT' });
    }
  });
}

/**
 * Refuse to start twice in one page.
 *
 * A second copy of this script is not a second panel — `HOST_ID` makes the DOM
 * idempotent — it is a second MutationObserver, a second poll timer, and a
 * second submit detector, all invisible. The capture guards are module state,
 * so the two instances cannot see each other's `captured` or `captureInFlight`
 * flags, and the duplicate write those exist to prevent comes straight back.
 *
 * `teardown` cannot cover this: it belongs to whichever instance is running,
 * and a fresh injection gets a fresh closure with nothing to tear down.
 *
 * Reachable because enabling an optional platform injects into tabs already
 * open on that host, and the same tab can be toggled off and on again. The
 * marker goes on `window`, not on the DOM, because it must be invisible to the
 * page and must not survive a navigation the way an attribute would.
 */
const RUNNING = '__banapplyContentScriptRunning';
type Marked = Window & { [RUNNING]?: boolean };

if ((window as Marked)[RUNNING]) {
  console.info('[banapply] content script already running here — second copy stood down');
} else {
  (window as Marked)[RUNNING] = true;
  start();
}

function start(): void {
  announce();
  listenForWebSession();
  watchNavigation();

  /*
   * Failures here must not become unhandled rejections. This script runs on
   * someone else's page, where an uncaught error is both useless to them and
   * reported against content.js:1 with no frame worth reading.
   */
  init().catch((error) => {
    console.warn('[banapply] init failed:', error);
  });
}
