import * as esbuild from 'esbuild';
import { watch as watchFile } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

/**
 * Three separate bundles rather than one Vite build.
 *
 * MV3 content scripts cannot use ES module imports, so content.js must be a
 * self-contained IIFE. The service worker CAN be a module (manifest declares
 * "type": "module"). Mixing those output formats is exactly what a plain
 * esbuild script handles well and what a single Vite config fights against.
 */
const shared = {
  bundle: true,
  target: 'chrome114',
  logLevel: 'info',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
};

const builds = [
  { entryPoints: [resolve(root, 'src/background.ts')], outfile: resolve(outdir, 'background.js'), format: 'esm' },
  { entryPoints: [resolve(root, 'src/content.ts')], outfile: resolve(outdir, 'content.js'), format: 'iife' },
  { entryPoints: [resolve(root, 'src/popup.ts')], outfile: resolve(outdir, 'popup.js'), format: 'iife' },
];

async function copyStatic() {
  await cp(resolve(root, 'manifest.json'), resolve(outdir, 'manifest.json'));
  await cp(resolve(root, 'src/popup.html'), resolve(outdir, 'popup.html'));
  await cp(resolve(root, 'src/popup.css'), resolve(outdir, 'popup.css'));
  await cp(resolve(root, 'icons'), resolve(outdir, 'icons'), { recursive: true }).catch(() => {
    console.warn('No icons/ directory found - add PNGs before publishing to the Web Store.');
  });
}

if (watch) {
  for (const build of builds) {
    const ctx = await esbuild.context({ ...shared, ...build });
    await ctx.watch();
  }
  await copyStatic();

  /*
   * esbuild only watches what it bundles, so manifest.json, popup.html and
   * popup.css were copied once at startup and never again. Editing the
   * manifest mid-session left dist holding the old one — the extension would
   * load without a permission or a content-script match that the source
   * clearly had, which reads as the change simply not working.
   */
  const staticFiles = [
    resolve(root, 'manifest.json'),
    resolve(root, 'src/popup.html'),
    resolve(root, 'src/popup.css'),
  ];

  let pending;
  for (const file of staticFiles) {
    watchFile(file, () => {
      // Editors write in bursts (truncate, then write), so a debounce avoids
      // copying a half-written file.
      clearTimeout(pending);
      pending = setTimeout(() => {
        void copyStatic().then(() => console.log('[watch] static files copied'));
      }, 120);
    });
  }

  console.log('Watching for changes (including manifest and popup assets)...');
} else {
  await Promise.all(builds.map((build) => esbuild.build({ ...shared, ...build })));
  await copyStatic();
  console.log(`Built extension to ${outdir}`);
}
