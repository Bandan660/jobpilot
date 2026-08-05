/**
 * Default API origin. Overridable at runtime from the popup so a dev build can
 * point at localhost and a published build at the deployed Worker without
 * rebuilding.
 *
 * NOTE: whatever origin you set must also appear in manifest.json's
 * host_permissions, or the service worker's fetch will be blocked.
 */
export const DEFAULT_API_BASE_URL = 'http://localhost:8787';

/** How long the content script waits for a client-rendered posting to appear. */
export const SPA_RENDER_TIMEOUT_MS = 10_000;
export const SPA_POLL_INTERVAL_MS = 400;
