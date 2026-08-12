import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useHydrated } from './useHydrated.js';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'banapply.theme';

interface ThemeValue {
  theme: Theme;
  /** True when following the OS rather than an explicit choice. */
  isSystem: boolean;
  toggle: () => void;
  reset: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/** Both guarded for the prerender pass, which has no window or localStorage. */
function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : null;
}

/**
 * Theme state.
 *
 * The CSS already handles the OS preference on its own via light-dark(), so
 * nothing is written to the DOM until the user makes an explicit choice —
 * which is what keeps "follow the system" working, including when the OS
 * setting changes while the page is open.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<Theme | null>(() => storedTheme());
  const [system, setSystem] = useState<Theme>(() => systemTheme());

  // Track the OS preference so the toggle icon stays correct while following it.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (override) {
      root.setAttribute('data-theme', override);
      localStorage.setItem(STORAGE_KEY, override);
    } else {
      root.removeAttribute('data-theme');
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [override]);

  const theme = override ?? system;

  const toggle = useCallback(() => {
    setOverride((current) => ((current ?? systemTheme()) === 'dark' ? 'light' : 'dark'));
  }, []);

  const reset = useCallback(() => setOverride(null), []);

  const value = useMemo(
    () => ({ theme, isSystem: override === null, toggle, reset }),
    [theme, override, toggle, reset]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}

export function ThemeToggle() {
  const { theme, isSystem, toggle, reset } = useTheme();
  const hydrated = useHydrated();
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      // Double-click returns to following the OS. A third visible state in the
      // header would cost more than it is worth for how rarely it is used.
      onDoubleClick={reset}
      aria-label={`Switch to ${next} theme${isSystem ? '' : ' (double-click to follow system)'}`}
      title={isSystem ? 'Following system theme' : `Using ${theme} theme`}
    >
      {/* The glyph depends on a preference the prerendered HTML cannot know,
          so it stays blank until hydration rather than guessing wrong. */}
      <span aria-hidden="true">{hydrated ? (theme === 'dark' ? '☾' : '☀') : ''}</span>
    </button>
  );
}
