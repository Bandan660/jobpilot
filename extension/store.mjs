/**
 * Builds the zip that goes to the Chrome Web Store.
 *
 * WHY THIS IS NOT JUST `Compress-Archive extension/dist/*`
 *
 * `dist` is the *development* build. It carries one thing a published
 * extension must not: `http://localhost:8787/*` in `host_permissions`. The
 * store's own listing has to justify every permission, and the only honest
 * justification for that one is "used during testing and debugging" — which is
 * an argument for not shipping it. Reviewers reject permissions that serve the
 * developer rather than the user, and a plain-HTTP localhost grant on a
 * published extension is exactly the sort of thing that draws a manual look.
 *
 * It stays in `manifest.json` because `npm run dev:api` needs it and the popup
 * override is how this gets tested against a local Worker. So the manifest that
 * ships is a transformed copy, made here, and `dist` is left alone.
 *
 * WHAT THIS DELIBERATELY DOES NOT STRIP
 *
 * The `.map` files. `build.mjs` sets out why they ship — a minified bundle with
 * no map turned a real error report into `content.js:322 (se)` and cost a
 * debugging session — and the usual counter-argument does not hold: a .crx is a
 * zip, anyone can unpack it, and Web Store review reads the source anyway. They
 * cost about 700KB against a 2GB limit and buy back every future crash report.
 *
 * Run it with `npm run build:store`.
 */
import { deflateRawSync } from 'node:zlib';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A ZIP writer, rather than whatever the platform provides.
 *
 * `Compress-Archive` writes entry names with backslashes on Windows — against
 * the spec, which says forward slashes — and archives built that way have a
 * long history of being rejected or unpacked into a single flat file by tools
 * that read the names literally. The Web Store is not somewhere to find out.
 * `tar -a -c -f out.zip` was the other candidate and did not produce a
 * readable archive here at all.
 *
 * Seventy lines of deflate and headers removes the entire class of problem, is
 * identical on every machine, and adds no dependency to a repo that has kept
 * its build to esbuild and Node.
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** DOS date/time. The zip format predates every sensible way to store this. */
function dosStamp(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** `entries` is [{ name, data }] with names already using forward slashes. */
function makeZip(entries, stamp) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.day, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + compressed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

/** Every file under `dir`, depth first, with zip-style relative names. */
async function collect(dir, prefix = '') {
  const found = [];

  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      found.push(...(await collect(join(dir, item.name), name)));
    } else {
      found.push({ name, data: await readFile(join(dir, item.name)) });
    }
  }

  return found;
}

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const staging = resolve(root, 'dist-store');

/**
 * Origins that exist for development and must not ship.
 *
 * Exact strings rather than patterns: a fuzzy match here would quietly drop a
 * production origin the day someone adds one that happens to contain
 * "localhost", and a permission missing from a published extension fails as a
 * blocked fetch, which is indistinguishable from a network error.
 */
const DEV_ONLY_HOSTS = ['http://localhost:8787/*'];

const manifestPath = resolve(dist, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const before = manifest.host_permissions ?? [];
const after = before.filter((host) => !DEV_ONLY_HOSTS.includes(host));
const stripped = before.filter((host) => DEV_ONLY_HOSTS.includes(host));

if (stripped.length === 0 && before.length > 0) {
  // Not fatal — someone may have already cleaned the manifest — but worth
  // saying, because a silent no-op here looks identical to a working strip.
  console.warn('No development hosts found to strip. Check manifest.json is as expected.');
}

manifest.host_permissions = after;

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(dist, staging, { recursive: true });
await writeFile(resolve(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const zip = resolve(root, `banapply-v${manifest.version}.zip`);
await rm(zip, { force: true });

/*
 * Collected from *inside* the staging directory, because the store requires
 * manifest.json at the root of the archive. Archiving the folder itself
 * produces `dist-store/manifest.json`, which is rejected with a message that
 * does not say which of the two mistakes you made.
 */
const entries = await collect(staging);
await writeFile(zip, makeZip(entries, dosStamp(new Date())));

console.log('');
console.log(`Packaged  ${zip}`);
console.log(`Version   ${manifest.version}`);
console.log(`Stripped  ${stripped.length ? stripped.join(', ') : '(nothing)'}`);
console.log(`Ships     ${after.join(', ')}`);
console.log('');
console.log('Before uploading, check:');
console.log('  - the version above is higher than the one already published');
console.log('  - the listing discloses assisted apply submitting forms (see CHROMEWEBSTORE.md)');
console.log('  - screenshots are captured and contain no real personal data');
