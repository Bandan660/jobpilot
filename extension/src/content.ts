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
import { findApplicationForm, flowFor, linkedinFlow, isNonApplicationForm } from './autofill/flows.js';
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
  console.info('[jobpilot]', ...args);
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
    console.warn('[jobpilot] capture failed:', result.error, payload);

    // Most likely not signed in. Prompt rather than failing silently, since the
    // user just did the thing we exist to record.
    renderBanner({
      tone: 'error',
      title: 'jobpilot could not save this',
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

async function computeMatch(): Promise<SkillMatch | null> {
  if (matchCache !== undefined) return matchCache;

  const description = pageDescription();
  if (!description) {
    matchCache = null;
    return null;
  }

  const profile = await loadProfile();
  // Not cached on failure: the user is probably about to sign in from the
  // panel, and caching null would leave the card missing until a reload.
  if (!profile) return null;

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
 * Mount the launcher once there is something worth acting on.
 *
 * Shows the button, not the panel — the panel opens on click. Signed out it
 * still mounts, carrying the sign-in form, because sending someone to the
 * toolbar popup and back is worse than showing it where they already are.
 */
async function maybeShowPanel(job: CapturedJob, duplicate: DuplicateMatch | null): Promise<void> {
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
    email: session.ok ? session.data.email : null,
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
          profileCache = undefined;
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

  const isNewMatch = matchCache === undefined;

  // Render analyzing state immediately if match computation is pending
  if (authenticated && isNewMatch) {
    await renderPanel(buildJobState(null, true), handlers);
  }

  const match = authenticated ? await computeMatch() : null;

  // Small delay so the analyzing animation plays smoothly on job switch
  if (authenticated && isNewMatch) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  await renderPanel(buildJobState(match, false), handlers);
}

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

      const jobKey = [job.externalId, job.title, job.company].join('|');
      const signature = [jobKey, fields].join('|');
      if (signature === lastSignature) return;

      const jobChanged = jobKey !== lastJobKey;
      lastSignature = signature;
      lastJobKey = jobKey;
      currentJob = job;
      if (jobChanged) {
        captured = false;
        submitRecorded = false;
        debug('job:', job.title, '@', job.company);
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

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void evaluate(), 300);
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

  // The comparison was about the posting that just went away.
  matchCache = undefined;

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

function watchNavigation(): void {
  let lastUrl = window.location.href;

  const onChange = () => {
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;
    void init();
  };

  /*
   * Patching history is necessary but not sufficient. LinkedIn changes the
   * visible posting in ways that do not always reach these hooks — a framework
   * that captured pushState before this script ran still calls the original —
   * so the URL is also polled. Cheap: a string compare a few times a second.
   */
  setInterval(onChange, 600);

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
 */
let profileCache: Profile | null | undefined;
let profileInFlight: Promise<Profile | null> | null = null;

async function loadProfile(options: { fresh?: boolean } = {}): Promise<Profile | null> {
  if (!options.fresh && profileCache !== undefined) return profileCache;

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
    if (result.ok) profileCache = profile;
    return profile;
  });

  if (!options.fresh) profileInFlight = request;

  try {
    return await request;
  } finally {
    if (!options.fresh) profileInFlight = null;
  }
}

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
  if (!/(^|.)jobpilot-3lg.pages.dev$/.test(window.location.hostname)) return;
  document.documentElement.dataset.jobpilotExtension =
    chrome.runtime.getManifest().version;
}

announce();
watchNavigation();

/*
 * Failures here must not become unhandled rejections. This script runs on
 * someone else's page, where an uncaught error is both useless to them and
 * reported against content.js:1 with no frame worth reading.
 */
init().catch((error) => {
  console.warn('[jobpilot] init failed:', error);
});
