import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BoltIcon } from './illustrations.js';

const DISMISS_KEY = 'jobpilot.extensionBannerDismissed';

/**
 * Prompt to install the Copilot extension, shown across the signed-in app.
 *
 * Two things keep it from being wallpaper.
 *
 * It hides once the extension is actually installed. The content script writes
 * `data-jobpilot-extension` onto the document on jobpilot's own pages, so the
 * check needs no extension id and no message round-trip — it just reads the
 * attribute. That has to happen after mount, because the script runs at
 * document_idle and may land after React does.
 *
 * And it can be dismissed for good. A banner that cannot be closed gets
 * ignored rather than acted on, and the profile page is somewhere people
 * return to often.
 */
export function ExtensionBanner() {
  // Starts hidden and appears only once both checks pass, so it can never
  // flash in front of someone who has the extension.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    const installed = () => Boolean(document.documentElement.dataset.jobpilotExtension);
    if (installed()) return;

    // The content script may not have run yet. One late re-check costs
    // nothing and avoids a banner that appears and then vanishes.
    const timer = setTimeout(() => setShow(!installed()), 600);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <aside className="ext-banner">
      <span className="ext-glyph" aria-hidden="true">
        <BoltIcon />
      </span>

      <div className="ext-copy">
        <strong>Add the jobpilot Copilot extension</strong>
        <p className="muted">
          Fills applications from this profile and records them as you send them. No copying,
          nothing to remember.
        </p>
      </div>

      {/*
        Points at the Copilot page rather than the Web Store: the extension is
        not published yet, and a button that leads to a 404 is worse than one
        that explains what it does.
      */}
      <Link className="btn btn-primary" to="/copilot">
        Get the extension
      </Link>

      <button
        className="icon-action"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setShow(false);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </aside>
  );
}
