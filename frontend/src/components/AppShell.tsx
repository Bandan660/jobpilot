import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { api } from '../api.js';
import { ThemeToggle } from '../theme.js';
import { Brand } from './SiteChrome.js';
import { ResumeBuilderLink } from './ResumeBuilderLink.js';

/**
 * Shell for the signed-in app.
 *
 * Three destinations, because there are three things this product does: see
 * what is happening, look at the pipeline, and keep the profile autofill reads
 * from. The reference has seven, most of which exist to sell something or to
 * surface job matches — neither of which this product does.
 */
const NAV = [
  { to: '/dashboard', label: 'Home', end: true },
  { to: '/dashboard/applications', label: 'Applications', end: false },
  { to: '/dashboard/profile', label: 'Profile', end: false },
];

export function AppShell() {
  const { signOut } = useAuth();

  /*
   * The admin link appears only for an admin, and the answer comes from the
   * server. There is no client-side notion of who is an admin — the allowlist
   * is a Worker secret — so this asks once per mount and defaults to hidden.
   *
   * Hiding it is presentation, not protection: /api/admin/* refuses anyone not
   * on the allowlist regardless of what the nav shows.
   */
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((s) => !cancelled && setIsAdmin(s.isAdmin))
      .catch(() => {
        // A failed probe is not an error worth surfacing — it costs a link,
        // not a feature, and the page it points at is one URL away.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <header className="app-nav">
        <div className="app-nav-inner">
          <Brand to="/dashboard" />

          <nav aria-label="Application">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink to="/dashboard/admin" end={false}>
                Admin
              </NavLink>
            )}
          </nav>

          {/*
            No link back to the marketing site. Once someone is signed in the
            marketing pages have nothing to offer them, and a route out of the
            product is not a feature. Signing out returns them to it.
          */}
          <div className="app-nav-actions">
            <ThemeToggle />
            <button className="btn btn-ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="app-body">
        <Outlet />
      </main>
    </div>
  );
}
