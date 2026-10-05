// Minimal static file server without dependencies (used for local development and by the tests).
//   node scripts/serve.mjs [port]      -> http://localhost:8080/
// Service workers work on http://localhost, so the offline mode can be tried without HTTPS.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const here = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(here, '..');

// Resolves with { url, close() }. port 0 picks a free port.
export function startServer({ root = APP_ROOT, port = 0, host = '127.0.0.1' } = {}) {
  const base = resolve(root);
  const server = createServer(async (request, response) => {
    try {
      let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = join(base, normalize(path));
      if (file !== base && !file.startsWith(base + '/')) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const data = await readFile(file);
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      response.end(data);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolvePromise({
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}/`,
        close: () => new Promise((done) => server.close(done)),
        server,
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 8080);
  const { url } = await startServer({ port, host: '0.0.0.0' });
  console.log(`MTG-Zähler läuft auf ${url}  (Strg+C zum Beenden)`);
}
