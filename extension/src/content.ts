import type {
  CapturedJob,
  DuplicateCheckResponse,
  DuplicateMatch,
  CaptureResponse,
  Profile,
} from '@jobpilot/shared';
import { findAdapter, type JobAdapter } from './adapters/index.js';
import { extractFromJsonLd } from './adapters/jsonld.js';
import { autofill, previewCoverage } from './autofill/index.js';
import { SPA_POLL_INTERVAL_MS, SPA_RENDER_TIMEOUT_MS } from './config.js';
import { send, type AutofillSummary, type Message } from './messages.js';
import { renderBanner, removeBanner } from './ui/banner.js';
import { renderPanel, removePanel } from './ui/panel.js';

/**
 * Post-submit text that ATSs render on success. Used alongside each adapter's
 * confirmation selectors, because selector names change far more often than
 * this copy does.
 */
const CONFIRMATION_PHRASES = [
  'thank you for applying',
  'thanks for applying',
  'application submitted',
  'application received',
  'we have received your application',
  'your application has been received',
  'successfully submitted',
];

/** Per-page-load guard. The server is idempotent, this just avoids noise. */
let captured = false;
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

  // Without at least one of these the row would be unidentifiable noise.
  if (!title && !company) return null;

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

/** Waits for a client-rendered posting; resolves as soon as content appears. */
async function waitForJob(adapter: JobAdapter, url: URL): Promise<CapturedJob | null> {
  const deadline = Date.now() + SPA_RENDER_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const job = buildJob(adapter, url);
    if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, SPA_POLL_INTERVAL_MS));
  }

  return null;
}

/* --------------------------- submit detection --------------------------- */

function pageLooksConfirmed(adapter: JobAdapter): boolean {
  if (adapter.confirmationSelectors.some((selector) => document.querySelector(selector))) {
    return true;
  }
  const text = document.body?.innerText?.toLowerCase() ?? '';
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
  return Boolean(
    form.querySelector('input[type="file"]') ||
      form.querySelector('input[type="email"]') ||
      form.querySelector('input[name*="resume" i], input[name*="email" i]')
  );
}

async function doCapture(job: CapturedJob, applied: boolean): Promise<void> {
  if (captured && applied) return;
  if (applied) captured = true;

  const message: Message = {
    type: 'CAPTURE',
    payload: { job, applied, capturedAt: new Date().toISOString() },
  };

  const result = await send<CaptureResponse>(message);

  if (!result.ok) {
    // Most likely not signed in. Prompt rather than failing silently, since the
    // user just did the thing we exist to record.
    renderBanner({
      tone: 'error',
      title: 'jobpilot could not save this',
      body: result.error,
    });
    return;
  }

  if (applied) {
    renderBanner({
      tone: 'success',
      title: 'Application tracked',
      body: `${result.data.application.title} at ${result.data.application.company.name}`,
    });
  }
}

function watchForSubmit(adapter: JobAdapter, getJob: () => CapturedJob | null): () => void {
  const onSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!looksLikeApplicationForm(form)) return;

    const job = getJob();
    if (job) doCapture(job, true).catch((e) => console.warn('[jobpilot] capture failed:', e));
  };

  // Capture phase: some ATSs call preventDefault and submit over XHR, which
  // would stop a bubble-phase listener from ever running.
  document.addEventListener('submit', onSubmit, true);

  const observer = new MutationObserver(() => {
    if (captured) return;
    if (!pageLooksConfirmed(adapter)) return;
    const job = getJob();
    if (job) void doCapture(job, true);
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  return () => {
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
 * Mount the launcher once there is something worth acting on.
 *
 * This shows the button, not the panel — the panel opens on click. The bar is
 * still deliberately high: a real job page, a signed-in user, and an actual
 * form on screen. Below that, even a button is clutter on someone else's site.
 */
async function maybeShowPanel(job: CapturedJob, duplicate: DuplicateMatch | null): Promise<void> {
  const session = await send<{ authenticated: boolean; email: string | null }>({
    type: 'GET_SESSION',
  });
  if (!session.ok || !session.data.authenticated) return;

  const profile = await loadProfile();
  if (!profile) return;

  const coverage = previewCoverage(profile);
  // No form on the page yet — this is the posting, not the application.
  if (coverage.total === 0 && !duplicate) return;

  await renderPanel(
    { job, coverage, email: session.data.email, duplicate },
    {
      onFill: async (overwrite) => {
        const summary = await runAutofill(overwrite, { silent: true });
        return { filled: summary.filled, unanswered: summary.unanswered.length };
      },
      onSave: async () => {
        await doCapture(job, false);
        return true;
      },
      onSignOut: () => {
        void send({ type: 'LOGOUT' }).then(() => removePanel());
      },
    }
  );
}

/* --------------------------------- init --------------------------------- */

async function init(): Promise<void> {
  teardown?.();
  teardown = null;
  removeBanner();
  removePanel();
  captured = false;
  currentJob = null;

  const url = new URL(window.location.href);
  const adapter = findAdapter(url);
  if (!adapter || !adapter.isJobPage(url)) return;

  const job = await waitForJob(adapter, url);
  if (!job) return;
  currentJob = job;

  // Landing directly on a confirmation page means the ATS redirected after a
  // submit that happened before this script loaded.
  if (pageLooksConfirmed(adapter)) {
    void doCapture(job, true);
  } else {
    // Panel first, then the duplicate result folds into it — two overlapping
    // floating surfaces on one page is worse than either alone.
    checkDuplicates(job)
      .then((duplicate) => maybeShowPanel(job, duplicate))
      .catch((error) => console.warn('[jobpilot] panel setup failed:', error));
  }

  teardown = watchForSubmit(adapter, () => currentJob);
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

async function loadProfile(): Promise<Profile | null> {
  const result = await send<{ profile: Profile }>({ type: 'GET_PROFILE' });
  return result.ok ? result.data.profile : null;
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
  options: { silent?: boolean } = {}
): Promise<AutofillSummary> {
  const profile = await loadProfile();
  if (!profile) {
    renderBanner({
      tone: 'error',
      title: 'Could not autofill',
      body: 'Sign in from the jobpilot popup, then try again.',
    });
    return { filled: 0, skipped: 0, unanswered: [] };
  }

  const result = autofill(profile, { overwrite });

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

watchNavigation();

/*
 * Failures here must not become unhandled rejections. This script runs on
 * someone else's page, where an uncaught error is both useless to them and
 * reported against content.js:1 with no frame worth reading.
 */
init().catch((error) => {
  console.warn('[jobpilot] init failed:', error);
});
