import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { AuthProvider, useAuth } from './auth.js';
import { ThemeProvider } from './theme.js';
import { SiteLayout } from './components/SiteChrome.js';
import { Home } from './pages/Home.js';
import { Copilot } from './pages/Copilot.js';
import { Tracker } from './pages/Tracker.js';
import { BlogIndex, BlogPost } from './pages/Blog.js';
import { Privacy, Terms } from './pages/Legal.js';
import { NotFound } from './pages/NotFound.js';

/*
 * Auth-gated routes are code-split: nobody reading a blog post should download
 * the dashboard, its table, or the demo fixtures.
 *
 * Only these are lazy. The marketing routes are prerendered with
 * renderToString, which cannot suspend — a lazy component there would render
 * its fallback into the static HTML instead of the page.
 */
const LoginPage = lazy(() =>
  import('./pages/LoginPage.js').then((m) => ({ default: m.LoginPage }))
);
const AppShell = lazy(() =>
  import('./components/AppShell.js').then((m) => ({ default: m.AppShell }))
);
const DashboardHome = lazy(() =>
  import('./pages/app/DashboardHome.js').then((m) => ({ default: m.DashboardHome }))
);
const ApplicationsPage = lazy(() =>
  import('./pages/app/ApplicationsPage.js').then((m) => ({ default: m.ApplicationsPage }))
);
const ProfilePage = lazy(() =>
  import('./pages/app/ProfilePage.js').then((m) => ({ default: m.ProfilePage }))
);
const AdminPage = lazy(() =>
  import('./pages/app/AdminPage.js').then((m) => ({ default: m.AdminPage }))
);
// Lazy above all: this chunk pulls in the PDF parser.
const Onboarding = lazy(() =>
  import('./pages/Onboarding.js').then((m) => ({ default: m.Onboarding }))
);

/**
 * Client-side navigation keeps scroll position; for page changes it shouldn't.
 *
 * Honours a hash target so links like /#faq land on the section rather than
 * being yanked to the top.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      // The target may not be mounted on the same tick as the route change.
      const frame = requestAnimationFrame(() => {
        document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' });
      });
      return () => cancelAnimationFrame(frame);
    }

    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // `replace` so the guard does not add a history entry the user can go back to.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/**
 * Keeps signed-in users out of the app until onboarding is done.
 *
 * Autofill reading an empty profile is worse than no autofill at all: it
 * appears to work, fills nothing, and the user only finds out after submitting
 * a half-empty application.
 */
function RequireOnboarded({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'ready' | 'needs-onboarding'>('checking');

  useEffect(() => {
    let cancelled = false;
    api
      .getProfile()
      .then(({ profile }) => {
        if (!cancelled) setState(profile.onboardingCompletedAt ? 'ready' : 'needs-onboarding');
      })
      // On a network failure, let them through rather than trapping them in a
      // redirect loop they cannot escape.
      .catch(() => !cancelled && setState('ready'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'checking') return <p className="centered">Loading…</p>;
  if (state === 'needs-onboarding') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/**
 * Everything except the router itself.
 *
 * The router is supplied by the entry point — BrowserRouter in the browser,
 * StaticRouter during the prerender pass — so both share one route table.
 */
export function AppRoutes() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ScrollToTop />
        <Routes>
          {/* Public site: shares the header and footer. */}
          <Route element={<SiteLayout />}>
            <Route index element={<Home />} />
            <Route path="job-application-tracker" element={<Tracker />} />
            <Route path="copilot" element={<Copilot />} />
            <Route path="blog" element={<BlogIndex />} />
            <Route path="blog/:slug" element={<BlogPost />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="terms" element={<Terms />} />
            {/* Inside the layout so a wrong URL keeps the header and footer. */}
            <Route path="*" element={<NotFound />} />
          </Route>

          {/*
            Auth sits outside the site layout. A marketing header on a sign-in
            page is just another way to leave it, and the split needs the full
            viewport.
          */}
          <Route
            path="/login"
            element={
              <Suspense fallback={<p className="centered">Loading…</p>}>
                <LoginPage mode="login" />
              </Suspense>
            }
          />
          <Route
            path="/signup"
            element={
              <Suspense fallback={<p className="centered">Loading…</p>}>
                <LoginPage mode="signup" />
              </Suspense>
            }
          />

          {/* App: its own shell, no marketing chrome. */}
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <Suspense fallback={<p className="centered">Loading…</p>}>
                  <Onboarding />
                </Suspense>
              </RequireAuth>
            }
          />

          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <RequireOnboarded>
                  <Suspense fallback={<p className="centered">Loading…</p>}>
                    <AppShell />
                  </Suspense>
                </RequireOnboarded>
              </RequireAuth>
            }
          >
            <Route index element={<DashboardHome />} />
            <Route path="applications" element={<ApplicationsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            {/* Guarded by the API, not by this route. The allowlist lives in a
                Worker secret, so a client-side check would be decoration. */}
            <Route path="admin" element={<AdminPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
