import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BoltIcon } from './illustrations.js';

/**
 * Prompt to install the Copilot extension, shown across the signed-in app.
 *
 * Deliberately not dismissible: without the extension the profile is a form
 * nothing reads, so this is a setup step rather than an advertisement.
 *
 * It does disappear on its own once the extension is installed — the content
 * script writes `data-BanApply-extension` onto the document on BanApply's own
 * pages, so the check needs no extension id and no message round-trip. That
 * has to run after mount, because the script loads at document_idle and may
 * land after React does.
 */
export function ExtensionBanner() {
  // Starts hidden and appears only once both checks pass, so it can never
  // flash in front of someone who has the extension.
  const [show, setShow] = useState(false);

  useEffect(() => {
    const installed = () => Boolean(document.documentElement.dataset.BanApplyExtension);
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
        <strong>Add the BanApply Copilot extension</strong>
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
    </aside>
  );
}
