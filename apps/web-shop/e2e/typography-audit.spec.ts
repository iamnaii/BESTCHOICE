// Typography audit — every storefront route (tools/typography-audit/routes.mjs shopRoutes(), which
// mirrors src/App.tsx) × 1440/390/320, measured on the BUILT + prerendered dist/ (never the vite dev
// server) with the in-page collector tools/typography-audit/collect.js.
//
// Opt-in: skipped unless TYPOGRAPHY_AUDIT=1, so CI and the default config never run it.
//   PRERENDER_API_BASE=http://127.0.0.1:9 npm --prefix apps/web-shop run build:prerender
//   cd apps/web-shop && TYPOGRAPHY_AUDIT=1 TYPOGRAPHY_OUT=$PWD/../../.tmp/typo-audit/shop-after \
//     npx playwright test -c e2e/typography-audit.config.ts
//   TYPOGRAPHY_ONLY=/how-it-works,/products/:id  (path or sample, comma-separated) · TYPOGRAPHY_WIDTHS=390
//
// Output <TYPOGRAPHY_OUT>/shop/route-<slug>-<width>.json
//   { app, route, sample, width, theme:'light', role:'guest'|'customer', status, reason?, redirectedTo?,
//     facts, unmatched, blockedHosts, pageErrors, fontsLoaded, screenshot }
//   status: rendered | empty | error | redirected | blocked — only `rendered` carries facts
// + route-<slug>-<width>.png (full page, after document.fonts.ready) + unmatched.json (union of the
// /api requests the fixture answered {}). Every request off 127.0.0.1 is aborted (fonts are self-hosted).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { shopRoutes } from '../../../tools/typography-audit/routes.mjs';
import { routeShopApi, seedCustomerSession } from './fixtures/shop-api';

interface ShopRoute { path: string; sample: string; auth: boolean }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COLLECTOR = path.resolve(HERE, '../../../tools/typography-audit/collect.js');
const DIST = path.resolve(HERE, '../dist');
const ORIGIN = 'http://127.0.0.1:5281';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
// Global Constraints: document subtrees are never measured (guard set + .parcel-label + .contract-body)
const EXCLUDE = '.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog,'
  + ' .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, .parcel-label,'
  + ' .contract-body, iframe, svg';
const ENABLED = process.env.TYPOGRAPHY_AUDIT === '1';
const OUT = process.env.TYPOGRAPHY_OUT ? path.resolve(process.env.TYPOGRAPHY_OUT, 'shop') : '';
const WIDTHS = (process.env.TYPOGRAPHY_WIDTHS || '1440,390,320').split(',').map(Number);
const ONLY = (process.env.TYPOGRAPHY_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const SETTLE_MS = 20_000;

// same viewport heights as the admin harness (apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts)
const viewport = (width: number) => ({ width, height: width >= 768 ? 1000 : width <= 320 ? 740 : 844 });

// filesystem-safe and stable: '/' → '_', other non [A-Za-z0-9-] characters dropped and, when anything
// was dropped (":id", "*", Thai), an 8-hex sha1 of the route path keeps the name unique
function routeSlug(routePath: string): string {
  const flat = routePath.replace(/^\/+/, '').replace(/\//g, '_');
  const ascii = flat.replace(/[^A-Za-z0-9_-]+/g, '');
  const base = ascii.replace(/-+/g, '-').replace(/_+/g, '_').replace(/^[-_]+|[-_]+$/g, '');
  if (ascii === flat) return base || 'root';
  return `${base || 'p'}-${crypto.createHash('sha1').update(routePath).digest('hex').slice(0, 8)}`;
}

const ROUTES = (shopRoutes() as ShopRoute[]).filter((r) => !ONLY.length || ONLY.includes(r.path) || ONLY.includes(r.sample));
const slugs = new Map<string, string>();
for (const r of shopRoutes() as ShopRoute[]) {
  const s = routeSlug(r.path);
  if (slugs.has(s)) throw new Error(`typography audit: slug ${s} for ${r.path} collides with ${slugs.get(s)}`);
  slugs.set(s, r.path);
}

test.skip(!ENABLED, 'opt-in: set TYPOGRAPHY_AUDIT=1 (see header)');

test.beforeAll(async () => {
  if (!OUT) throw new Error('TYPOGRAPHY_OUT is required when TYPOGRAPHY_AUDIT=1');
  fs.mkdirSync(OUT, { recursive: true });
  // the server on :5281 must serve THIS checkout's dist (not another worktree's build)
  const local = fs.readFileSync(path.join(DIST, 'spa-shell.html'), 'utf8');
  const served = await fetch(`${ORIGIN}/spa-shell.html`).then((r) => r.text(), () => null);
  if (served !== local) throw new Error(`${ORIGIN} does not serve ${DIST} — run with -c e2e/typography-audit.config.ts`);
});

test.afterAll(() => {
  if (!OUT || !fs.existsSync(OUT)) return;
  const byRequest = new Map<string, string[]>();
  for (const f of fs.readdirSync(OUT).filter((n) => /^route-.+\.json$/.test(n)).sort()) {
    const run = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
    for (const req of run.unmatched ?? []) {
      const at = `${run.route} @${run.width}`;
      byRequest.set(req, [...(byRequest.get(req) ?? []), at]);
    }
  }
  const entries = [...byRequest].map(([request, routes]) => ({ request, routes }));
  fs.writeFileSync(path.join(OUT, 'unmatched.json'), `${JSON.stringify({ entries }, null, 2)}\n`);
});

for (const r of ROUTES) {
  for (const width of WIDTHS) {
    test(`${r.path} @${width}`, async ({ page }) => {
      const slug = routeSlug(r.path);
      const role = r.auth ? 'customer' : 'guest';
      const blockedHosts = new Set<string>();
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
      await page.route((url) => !LOCAL_HOSTS.has(url.hostname), (route) => {
        blockedHosts.add(new URL(route.request().url()).host);
        return route.abort();
      });
      const api = await routeShopApi(page);
      if (r.auth) await seedCustomerSession(page);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
      await page.setViewportSize(viewport(width));

      let status: string;
      let reason: string | undefined;
      let redirectedTo: string | undefined;
      let facts: unknown[] = [];
      try {
        await page.goto(ORIGIN + encodeURI(r.sample), { waitUntil: 'load', timeout: 45_000 });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        const settled = await page.waitForFunction(() => {
          const root = document.getElementById('root');
          if (!root || !root.innerText.trim()) return false;
          return ![...root.querySelectorAll('.animate-pulse')].some((e) => e.getClientRects().length > 0);
        }, undefined, { timeout: SETTLE_MS }).then(() => true, () => false);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));

        const finalPath = decodeURI(new URL(page.url()).pathname);
        const probe = await page.evaluate(() => ({
          notFound: [...document.querySelectorAll('h1')].some((h) => h.textContent?.trim() === 'ไม่พบหน้านี้'),
          errorState: document.querySelector('svg.text-destructive.size-12')?.parentElement?.querySelector('h3')
            ?.textContent?.trim() ?? null,
        }));
        if (finalPath !== r.sample) {
          redirectedTo = finalPath;
          if (r.auth && finalPath === '/login') {
            status = 'blocked';
            reason = 'customer session fixture not honoured — redirected to /login';
          } else {
            status = 'redirected';
          }
        } else if (probe.notFound) {
          status = 'error';
          reason = 'NotFoundPage rendered';
        } else if (probe.errorState) {
          status = 'error';
          reason = `ErrorState rendered: ${probe.errorState}`;
        } else if (!settled) {
          status = 'error';
          reason = `still loading (skeleton visible or #root empty) after ${SETTLE_MS} ms`;
        } else {
          await page.addScriptTag({ path: COLLECTOR });
          try {
            facts = await page.evaluate((exclude) => (window as unknown as {
              __collectTypography: (o: { exclude: string }) => unknown[];
            }).__collectTypography({ exclude }), EXCLUDE);
            status = facts.length ? 'rendered' : 'empty';
          } catch (e) {
            status = 'error';
            reason = `collector: ${(e as Error).message.split('\n')[0]}`;
          }
        }
      } catch (e) {
        status = 'error';
        reason = `navigation: ${(e as Error).message.split('\n')[0]}`;
      }

      const fontsLoaded = await page.evaluate(() => [...new Set([...document.fonts]
        .filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/["']/g, '')} ${f.weight}`))].sort())
        .catch(() => [] as string[]);
      const screenshot = `route-${slug}-${width}.png`;
      await page.screenshot({ path: path.join(OUT, screenshot), fullPage: true, animations: 'disabled' })
        .catch((e: Error) => { reason = `${reason ? `${reason}; ` : ''}screenshot: ${e.message.split('\n')[0]}`; });

      const run = {
        app: 'shop', route: r.path, sample: r.sample, width, theme: 'light', role, status,
        ...(reason ? { reason } : {}), ...(redirectedTo ? { redirectedTo } : {}),
        facts, unmatched: api.unmatched, blockedHosts: [...blockedHosts].sort(), pageErrors, fontsLoaded, screenshot,
      };
      fs.writeFileSync(path.join(OUT, `route-${slug}-${width}.json`), `${JSON.stringify(run, null, 2)}\n`);
      test.info().annotations.push({ type: 'typography', description: `${status} · ${facts.length} facts${reason ? ` · ${reason}` : ''}` });
    });
  }
}
