/**
 * Hand the session to the extension, once it is installed and we are signed in.
 *
 * Sign-in lives here rather than in the extension popup — Google's consent flow
 * needs a real browsing context, and one identity provider deserves one sign-in
 * surface. The consequence is that the extension has no way to authenticate on
 * its own, so the website has to pass the result along.
 *
 * The channel is `window.postMessage`, picked up by the content script that
 * already runs on this origin. Nothing crosses the network, and the token never
 * leaves the browser.
 *
 * WHY POSTMESSAGE AND NOT chrome.runtime.sendMessage
 *
 * A page can only call `chrome.runtime.sendMessage` if the extension declares
 * the origin in `externally_connectable`, which pins the manifest to a
 * hardcoded domain and breaks on every Pages preview deployment. The content
 * script is already on this page for other reasons; posting to it costs nothing
 * and keeps the domain list in one place.
 *
 * TARGET ORIGIN IS NEVER '*'
 *
 * `window.location.origin` restricts delivery to this page. `'*'` would post a
 * bearer token to whatever happens to be listening, which is the standard way
 * this pattern is got wrong.
 */

/** Set by the content script on mount, and the only signal the extension is here. */
function extensionPresent(): boolean {
  return typeof document !== 'undefined' && 'jobpilotExtension' in document.documentElement.dataset;
}

/**
 * Post the session, if there is one and there is something to receive it.
 *
 * Safe to call more than once. The extension writes the same value again, which
 * `chrome.storage` treats as a change but which produces no visible effect —
 * cheaper than tracking whether this has already run across a page load.
 */
export function handOffSession(token: string | null, email: string | null): void {
  if (typeof window === 'undefined') return;
  if (!token || !extensionPresent()) return;

  window.postMessage(
    { source: 'jobpilot-web', type: 'SESSION', token, email: email ?? '' },
    window.location.origin
  );
}

/**
 * Wait briefly for the content script, then hand over.
 *
 * The attribute is set on mount, and on a fast connection this module can run
 * first — so a single check misses an extension that is present and about to
 * announce itself. Polls for a couple of seconds, then gives up rather than
 * watching forever for something that is not installed.
 *
 * Returns a cleanup function for the caller's effect.
 */
export function handOffWhenReady(token: string | null, email: string | null): () => void {
  if (typeof window === 'undefined' || !token) return () => {};

  if (extensionPresent()) {
    handOffSession(token, email);
    return () => {};
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;

    if (extensionPresent()) {
      handOffSession(token, email);
      window.clearInterval(timer);
      return;
    }

    // ~2s. Long enough for the content script on a slow page, short enough that
    // a browser without the extension is not polling indefinitely.
    if (attempts >= 20) window.clearInterval(timer);
  }, 100);

  return () => window.clearInterval(timer);
}
