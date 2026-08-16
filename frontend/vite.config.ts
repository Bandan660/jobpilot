import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { POSTS } from './src/content/posts';

/** Update once the real domain is bought; also referenced in public/robots.txt. */
const SITE_URL = 'https://banapply.com';

/**
 * Emits sitemap.xml at build time from the actual route list.
 *
 * Generated rather than checked in so it cannot drift: adding a post to
 * posts.ts is enough, with no second place to remember to update.
 */
function sitemap(): Plugin {
  return {
    name: 'jobpilot-sitemap',
    // Client build only — the SSR pass would emit a second, discarded copy.
    apply: (config, env) => env.command === 'build' && !config.build?.ssr,
    generateBundle() {
      const staticRoutes = [
        { path: '/', priority: '1.0', changefreq: 'weekly' },
        { path: '/job-application-tracker', priority: '0.9', changefreq: 'monthly' },
        { path: '/copilot', priority: '0.9', changefreq: 'monthly' },
        { path: '/blog', priority: '0.8', changefreq: 'weekly' },
        { path: '/privacy', priority: '0.3', changefreq: 'yearly' },
        { path: '/terms', priority: '0.3', changefreq: 'yearly' },
      ];

      const postRoutes = POSTS.map((post) => ({
        path: `/blog/${post.slug}`,
        priority: '0.7',
        changefreq: 'monthly',
        lastmod: post.updated ?? post.date,
      }));

      const entries = [...staticRoutes, ...postRoutes]
        .map((route) => {
          const lastmod = 'lastmod' in route && route.lastmod ? `\n    <lastmod>${route.lastmod}</lastmod>` : '';
          return `  <url>\n    <loc>${SITE_URL}${route.path}</loc>${lastmod}\n    <changefreq>${route.changefreq}</changefreq>\n    <priority>${route.priority}</priority>\n  </url>`;
        })
        .join('\n');

      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`,
      });
    },
  };
}

/**
 * Preloads the latin font files.
 *
 * Without this the browser cannot discover the fonts until it has downloaded
 * and parsed the CSS — a serial request chain in front of the first text paint.
 * The filenames are content-hashed, so they are read from the bundle rather
 * than hardcoded.
 */
function preloadFonts(): Plugin {
  return {
    name: 'jobpilot-preload-fonts',
    apply: (config, env) => env.command === 'build' && !config.build?.ssr,
    enforce: 'post',
    // Filenames are read from the bundle passed to this hook rather than
    // stashed in generateBundle — plugin hook ordering between the two is not
    // guaranteed, and stashing silently produced no preloads at all.
    transformIndexHtml(_html, ctx) {
      const hrefs = Object.keys(ctx.bundle ?? {})
        .filter((file) => /geist(-mono)?-latin-wght-normal.*\.woff2$/.test(file))
        .map((file) => `/${file}`);

      return hrefs.map((href) => ({
        tag: 'link',
        attrs: {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href,
          // Fonts are always fetched in CORS mode; without this the preload is
          // discarded and the file is requested a second time.
          crossorigin: '',
        },
        injectTo: 'head-prepend' as const,
      }));
    },
  };
}

export default defineConfig({
  plugins: [react(), sitemap(), preloadFonts()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    // Off in production: ~1 MB of maps that browsers never request, and they
    // publish your unminified source to anyone who looks.
    sourcemap: false,
  },
});
