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
  // Synchronous check on mount so banner renders immediately with page layout
  const [show, setShow] = useState(() => {
    if (typeof document === 'undefined') return false;
    return !document.documentElement.dataset.BanApplyExtension && !document.documentElement.dataset.jobpilotExtension;
  });

  useEffect(() => {
    const checkInstalled = () => {
      const installed = Boolean(
        document.documentElement.dataset.BanApplyExtension ||
          document.documentElement.dataset.jobpilotExtension
      );
      if (installed) {
        setShow(false);
      }
    };

    checkInstalled();
    const timer = setTimeout(checkInstalled, 150);
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

      {import.meta.env.VITE_CHROME_STORE_URL ? (
        <a
          className="btn btn-primary"
          href={import.meta.env.VITE_CHROME_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Get extension in Chrome Store ↗
        </a>
      ) : (
        <Link className="btn btn-primary" to="/copilot">
          Get the extension
        </Link>
      )}
    </aside>
  );
}
