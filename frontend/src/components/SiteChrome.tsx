import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { ThemeToggle } from '../theme.js';
import { useHydrated } from '../useHydrated.js';
import { ResumeBuilderLink } from './ResumeBuilderLink.js';

/**
 * `to` is configurable because the wordmark should go somewhere useful from
 * wherever it is: the marketing home from the public site, the dashboard from
 * inside the app.
 */
/*
 * SVG rather than the ☰ and ✕ characters that were here before. Those are
 * font glyphs: they land at different weights and sizes on every platform, and
 * several render them as colour emoji. These inherit currentColor and are
 * exactly the size they are told to be.
 */
const glyph = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
  width: 18,
  height: 18,
};

function MenuGlyph() {
  return (
    <svg {...glyph}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg {...glyph}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="BanApply">
      <span className="brand-mark" aria-hidden="true">
        ◆
      </span>
      BanApply
    </Link>
  );
}

const NAV_LINKS = [
  // The tracker route keeps its long, descriptive slug because it is the
  // page most likely to be found by search; the nav label is shortened only
  // so five items still fit on one line.
  { to: '/job-application-tracker', label: 'Job Tracker' },
  { to: '/copilot', label: 'Copilot' },
  { to: '/blog', label: 'Blog' },
];

function SiteHeader() {
  const { isAuthenticated } = useAuth();
  const hydrated = useHydrated();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  // Sign-in state comes from localStorage, which the prerendered HTML has no
  // access to. Render the signed-out header until hydration so the static
  // markup and the first client render agree.
  const signedIn = hydrated && isAuthenticated;

  // Navigating with the menu open would otherwise leave it covering the new page.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="site-header">
      <div className="shell">
        <Brand />

        <nav className="site-nav" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to}>
              {link.label}
            </NavLink>
          ))}
          <ResumeBuilderLink path="/" medium="nav">
            Resume Builder
          </ResumeBuilderLink>
        </nav>

        <div className="header-actions">
          <ThemeToggle />
          {signedIn ? (
            <Link className="btn btn-primary btn-header-cta" to="/dashboard">
              <span className="hide-small-mobile">Open tracker</span>
              <span className="show-small-mobile">Tracker</span>
            </Link>
          ) : (
            <>
              <Link className="btn btn-ghost hide-mobile" to="/login">
                Log in
              </Link>
              {/* Short form of the landing CTA — the header has no room for
                  the full "Join now — it's free". */}
              <Link className="btn btn-primary btn-header-cta" to="/signup">
                <span className="hide-small-mobile">Join free</span>
                <span className="show-small-mobile">Join</span>
              </Link>
            </>
          )}

          <button
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <CloseGlyph /> : <MenuGlyph />}
          </button>
        </div>
      </div>

      {/* Rendered unconditionally and hidden with [hidden] so the toggle's
          aria-controls always points at a real element. */}
      <nav id="mobile-nav" className="mobile-nav" aria-label="Main" hidden={!menuOpen}>
        {NAV_LINKS.map((link) => (
          <NavLink key={link.to} to={link.to}>
            {link.label}
          </NavLink>
        ))}
        <ResumeBuilderLink path="/" medium="nav_mobile">
          Resume Builder
        </ResumeBuilderLink>
        {!signedIn && <NavLink to="/login">Log in</NavLink>}
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell">
        {/* Status readout rather than a tagline — it says something true and
            current, and it keeps the instrument language to the last line. */}
        <div className="footer-status">
          <span className="pulse" aria-hidden="true" />
          <span>Capture online</span>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <span>sweep every 6h</span>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <span>3 boards supported</span>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <span>early access</span>
        </div>

        <div className="footer-cols">
          <nav aria-label="Product">
            <span className="footer-heading">Product</span>
            {/* Full label here — the footer has room, and it is the phrase people search for. */}
            <Link to="/job-application-tracker">Job Application Tracker</Link>
            <Link to="/copilot">Copilot extension</Link>
          <ResumeBuilderLink path="/" medium="footer">
            Free ATS resume builder
          </ResumeBuilderLink>
          </nav>

          <nav aria-label="Resources">
            <span className="footer-heading">Resources</span>
            <Link to="/blog">Blog</Link>
            {/* The FAQ is a section of the home page now, not its own route. */}
            <Link to="/#faq">FAQ</Link>
          </nav>

          <nav aria-label="Legal">
            <span className="footer-heading">Legal</span>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>

        <div className="footer-baseline">
          <span>© 2026 BanApply</span>
          <span>Free while it&rsquo;s in early access</span>
        </div>

        <span className="footer-wordmark" aria-hidden="true">
          BanApply
        </span>
      </div>
    </footer>
  );
}

export function SiteLayout() {
  return (
    <div className="marketing">
      <SiteHeader />
      <main>
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
