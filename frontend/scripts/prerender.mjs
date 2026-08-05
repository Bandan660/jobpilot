/**
 * Prerenders the public routes to static HTML.
 *
 * Run after both builds:
 *   vite build                    -> dist/         (client)
 *   vite build --ssr ...          -> dist-ssr/     (render function)
 *   node scripts/prerender.mjs    -> dist/<route>/index.html
 *
 * The result is that every marketing and blog URL serves complete markup:
 * the browser paints text without waiting on JavaScript, and crawlers that do
 * not execute JS still see the title, description, and BlogPosting JSON-LD.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const ssrEntry = join(root, 'dist-ssr', 'entry-server.js');

const { render, routes } = await import(pathToFileURL(ssrEntry).href);

const template = await readFile(join(dist, 'index.html'), 'utf8');

let written = 0;

for (const route of routes) {
  const { html, head } = render(route);

  let page = template.replace('<div id="root"></div>', `<div id="root">${html}</div>`);

  if (head) {
    // The generated tags supersede the static defaults in index.html, so the
    // originals are stripped rather than duplicated.
    page = page
      .replace(/<title>[\s\S]*?<\/title>\s*/, '')
      .replace(/<meta\s+name="description"[^>]*>\s*/, '')
      .replace(/<meta\s+property="og:(?:title|description|type|url)"[^>]*>\s*/g, '')
      .replace('</head>', `  ${head}\n  </head>`);
  }

  const target = route === '/' ? join(dist, 'index.html') : join(dist, route, 'index.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, page, 'utf8');
  written += 1;
}

// The SSR bundle is a build artefact, not something to deploy.
await rm(join(root, 'dist-ssr'), { recursive: true, force: true });

console.log(`Prerendered ${written} routes`);
