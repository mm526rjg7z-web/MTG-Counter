// Keeps sw.js in sync with the app files:
//   * ASSETS  = every file the app needs offline (index.html, styles.css, app.js, manifest, js/*, icons/*)
//   * CACHE_VERSION = hash of the names and contents of those files
// Any change to an app file therefore produces a new cache name, so installed apps pick it up.
//
//   node scripts/update-cache-version.mjs           rewrite sw.js
//   node scripts/update-cache-version.mjs --check   exit 1 if sw.js is out of date (used by the tests)

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_FILES = ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest'];
const ASSET_DIRS = ['js', 'icons'];
const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.svg']);

export async function collectAssets(root = APP_ROOT) {
  const files = [...ROOT_FILES];
  for (const dir of ASSET_DIRS) {
    const names = (await readdir(join(root, dir), { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    files.push(...names.map((name) => `${dir}/${name}`));
  }
  return files;
}

export async function computeVersion(files, root = APP_ROOT) {
  const hash = createHash('sha256');
  for (const file of files) {
    let data = await readFile(join(root, file));
    // Git may check text files out with CRLF on Windows; the version must not depend on that.
    if (TEXT_EXTENSIONS.has(extname(file))) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
    hash.update(`${file}\0`);
    hash.update(data);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 10);
}

export function renderServiceWorker(source, files, version) {
  const list = ['./', ...files.map((file) => `./${file}`)].map((url) => `  '${url}',`).join('\n');
  return source
    .replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = '${version}';`)
    .replace(/const ASSETS = \[[\s\S]*?\n\];/, `const ASSETS = [\n${list}\n];`);
}

export async function buildServiceWorker(root = APP_ROOT) {
  const swPath = join(root, 'sw.js');
  const current = await readFile(swPath, 'utf8');
  const files = await collectAssets(root);
  const version = await computeVersion(files, root);
  return { swPath, current, next: renderServiceWorker(current, files, version), version, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { swPath, current, next, version, files } = await buildServiceWorker();
  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error('sw.js ist veraltet. Bitte "node scripts/update-cache-version.mjs" ausführen.');
      process.exit(1);
    }
    console.log(`sw.js ist aktuell (Version ${version}).`);
  } else if (current === next) {
    console.log(`sw.js war bereits aktuell (Version ${version}, ${files.length} Dateien).`);
  } else {
    await writeFile(swPath, next);
    console.log(`sw.js aktualisiert: Version ${version}, ${files.length} Dateien im Cache.`);
  }
}
