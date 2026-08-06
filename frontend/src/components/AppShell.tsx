import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { ThemeToggle } from '../theme.js';
import { Brand } from './SiteChrome.js';

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
