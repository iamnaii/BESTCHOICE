// Typography audit — static server for the BUILT storefront (apps/web-shop/dist), mirroring the
// firebase.json hosting target "shop" (public apps/web-shop/dist, trailingSlash false):
//   1. the exact file                      (/assets/x.js, /favicon.svg, /spa-shell.html …)
//   2. else <path>/index.html               (prerender output; Thai paths are percent-decoded first)
//   3. else /spa-shell.html, status 200     (the `**` rewrite)
// A trailing slash redirects (301) to the slash-less path, like trailingSlash:false. /api/** is never
// served here — the Playwright fixture (shop-api.ts) answers it before the request leaves the page;
// anything that still arrives gets 404 so a missing mock can never fall through to the SPA shell.
//
//   node apps/web-shop/e2e/fixtures/static-server.mjs [--port 5281] [--root <dist dir>]
//   import { startStaticServer } from './static-server.mjs'  → { url, close() }

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 5281;
export const DEFAULT_ROOT = fileURLToPath(new URL('../../dist/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// pathname (already decoded) → file to serve (firebase order), or null when it escapes root
export function resolveHostingFile(root, pathname) {
  const base = path.resolve(root);
  const inside = (p) => p === base || p.startsWith(base + path.sep);
  const exact = path.resolve(base, `.${pathname}`);
  if (!inside(exact)) return null;
  if (isFile(exact)) return exact;
  const index = path.join(exact, 'index.html');
  if (isFile(index)) return index;
  return path.join(base, 'spa-shell.html');
}

function handler(root) {
  return (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'cache-control': 'no-store', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return send(400, 'bad path');
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return send(404, '{"message":"static-server never serves /api — mock it in the page"}', {
        'content-type': TYPES['.json'],
      });
    }
    if (pathname.length > 1 && pathname.endsWith('/')) {
      return send(301, '', { location: url.pathname.replace(/\/+$/, '') + url.search });
    }
    const file = resolveHostingFile(root, pathname);
    if (!file) return send(403, 'forbidden');
    fs.readFile(file, (err, body) => {
      if (err) return send(404, 'not found');
      send(200, body, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    });
  };
}

export function startStaticServer({ root = DEFAULT_ROOT, port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
  if (!isFile(path.join(root, 'spa-shell.html'))) {
    return Promise.reject(new Error(`static-server: ${root} has no spa-shell.html — build first`
      + ' (PRERENDER_API_BASE=http://127.0.0.1:9 npm --prefix apps/web-shop run build:prerender)'));
  }
  const server = http.createServer(handler(root));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({
        url: `http://${host}:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const root = path.resolve(arg('--root') ?? DEFAULT_ROOT);
  const port = Number(arg('--port') ?? DEFAULT_PORT);
  startStaticServer({ root, port }).then(
    ({ url }) => process.stdout.write(`static-server ${url} (root ${root})\n`),
    (err) => {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    },
  );
}
