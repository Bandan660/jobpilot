import { useEffect, useState } from 'react';

/**
 * False during the prerender pass and on the first client render, true after.
 *
 * Prerendered HTML cannot know the visitor's theme or whether they are signed
 * in — both live in localStorage. Rendering a guess would produce markup that
 * disagrees with what the client renders, which React reports as a hydration
 * error and Lighthouse counts against Best Practices.
 *
 * So anything that depends on browser-only state renders a neutral placeholder
 * until this flips, one tick after mount.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}
