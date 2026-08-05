import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage }))
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
            <Route
              path="login"
              element={
                <Suspense fallback={<p className="centered">Loading…</p>}>
                  <LoginPage mode="login" />
                </Suspense>
              }
            />
            <Route
              path="signup"
              element={
                <Suspense fallback={<p className="centered">Loading…</p>}>
                  <LoginPage mode="signup" />
                </Suspense>
              }
            />
            {/* Inside the layout so a wrong URL keeps the header and footer. */}
            <Route path="*" element={<NotFound />} />
          </Route>

          {/* App: its own shell, no marketing chrome. */}
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <Suspense fallback={<p className="centered">Loading your pipeline…</p>}>
                  <DashboardPage />
                </Suspense>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
