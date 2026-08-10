/**
 * API origin.
 *
 * This is the deployed Worker, not localhost. A published extension that
 * defaults to a dev server is simply broken for everyone who installs it —
 * and the failure is quiet, because a blocked fetch looks exactly like a
 * network error.
 *
 * For local development, override it from the popup's "API base URL" field;
 * `localhost:8787` stays in host_permissions so that override works without
 * rebuilding.
 *
 * IMPORTANT: any origin used here or entered in the popup must appear in
 * manifest.json's host_permissions, or the service worker's fetch is blocked
 * before it leaves the browser.
 */
export const DEFAULT_API_BASE_URL = 'https://jobpilot-api.jobpilot.workers.dev';
export const DEFAULT_WEB_BASE_URL = 'https://jobpilot-3lg.pages.dev';

/**
 * How often the confirmation check may run, at most.
 *
 * It reads `innerText`, which forces a layout, and it is driven by a
 * MutationObserver on a page that mutates continuously. A confirmation screen
 * does not come and go inside this window.
 */
export const CONFIRMATION_CHECK_MS = 400;


/** How long the content script waits for a client-rendered posting to appear. */
export const SPA_RENDER_TIMEOUT_MS = 10_000;
export const SPA_POLL_INTERVAL_MS = 400;
