import { renderToString } from 'react-dom/server';
// v7 dropped the react-router-dom/server subpath; StaticRouter is on the main entry.
import { StaticRouter } from 'react-router-dom';
import { AppRoutes } from './App.js';
import { POSTS } from './content/posts.js';
import { getCollectedSeo, renderSeoTags, resetSeo } from './usePageMeta.js';

/**
 * Every route that gets static HTML.
 *
 * Exported from here rather than listed in the build script so post URLs come
 * from the same source as the sitemap and the blog itself — adding a post
 * needs no second edit. Auth routes are excluded: they are behind a login,
 * noindex, and have nothing to prerender.
 */
export const routes: string[] = [
  '/',
  '/job-application-tracker',
  '/copilot',
  '/blog',
  '/privacy',
  '/terms',
  ...POSTS.map((post) => `/blog/${post.slug}`),
];

/**
 * Prerender entry.
 *
 * Called once per route by scripts/prerender.mjs at build time. Returns the
 * body markup and the head tags collected while rendering, which the script
 * splices into the built index.html.
 *
 * renderToString is deliberate: it is synchronous, so the SEO collector can
 * read what the tree declared without any streaming or suspense plumbing. The
 * cost is that lazy components cannot appear on prerendered routes — see the
 * comment in App.tsx.
 */
export function render(url: string): { html: string; head: string } {
  resetSeo();

  const html = renderToString(
    <StaticRouter location={url}>
      <AppRoutes />
    </StaticRouter>
  );

  return { html, head: renderSeoTags(getCollectedSeo()) };
}
