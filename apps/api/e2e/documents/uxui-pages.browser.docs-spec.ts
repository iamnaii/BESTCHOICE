/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import type { Page } from '@playwright/test';
import { startDocumentsApp, DocumentsHarness } from './support/harness';
import { seedDocumentsWorld, DocumentsWorld } from './support/fixtures';
import { startWeb, WebRuntime } from './support/web';
import { saveArtifact } from './support/artifacts';
import { seedLiffSession, routeLiffApi } from './support/liff-fixtures';
import { seedSystemUi } from '../ui-fields/system-fixtures';

// Route/state inventory, not a replacement for the domain transaction suites.
// Real API reads; synthetic records; no mutation or external messages.
//
// Opt-in typography audit (UXUI_TYPOGRAPHY=1 — never set on CI; flag off = the inventory run unchanged):
// after each theme's readiness/screenshot the in-page collector (tools/typography-audit/collect.js) records
// typography facts to <DOCS_QA_OUTPUT>/typography/route-<no>-<width>-<theme>-<role>.json as
// { no, route, width, theme, role, status, facts, target?, finalPath?, error? }. Status per row × theme:
//   document   — row.type 'document' (customer documents / paper): no navigation, no measurement, no screenshot
//   error      — navigation/readiness threw, the root error boundary ("โหลดหน้าใหม่") showed, the row raised
//                page errors, or the collector threw (e.g. the canvas rejected a font) — `error` says which
//   redirected — the final pathname differs from the resolved target pathname (query/hash ignored), incl. a
//                settings-inline panel that never mounted because the role was sent elsewhere (finalPath = there)
//   empty      — rendered, but the collector found 0 facts or the main region has no text
//   rendered   — otherwise
// facts are kept only for `rendered`. LIFF rows get a seeded synthetic customer session + mocked LIFF API
// (support/liff-fixtures.ts) instead of `?login_error=true`. A width batch passes when every row × theme wrote
// its JSON (any status) and no external message was sent — REVIEW rows become statuses, not failures.
// UXUI_ROLE (owner | salesA) picks the signed-in user; UXUI_UI_FONT (default Noto Sans Thai) is the UI font the
// wrongFonts/fontLoaded evidence expects (the BEFORE run passes 'Noto Sans Thai Looped').
const typography = process.env.UXUI_TYPOGRAPHY === '1';
const role = (process.env.UXUI_ROLE || 'owner') as 'owner' | 'salesA';
if (!['owner', 'salesA'].includes(role)) throw new Error('Invalid UXUI_ROLE (owner | salesA)');
const uiFont = process.env.UXUI_UI_FONT || 'Noto Sans Thai';
const uiFontPattern = uiFont.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const THEMES = ['light', 'dark'] as const;
const collectorPath = resolve(__dirname, '../../../../tools/typography-audit/collect.js');
// Paper/document subtrees are never audited (Global Constraints): guard set + .parcel-label + .contract-body.
const TYPOGRAPHY_EXCLUDE = '.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, .parcel-label, .contract-body, iframe, svg';
type TypographyStatus = 'rendered' | 'empty' | 'error' | 'redirected' | 'document';
type ThemeCapture = { facts?: unknown[]; collectorError?: string; finalPath: string; text: string };
const pathnameOf = (path: string) => new URL(path, 'http://uxui.invalid').pathname;
const inventorySource = process.env.UXUI_INVENTORY
  ? JSON.parse(readFileSync(resolve(process.env.UXUI_INVENTORY), 'utf8')).rows
      .filter((row: { app: string }) => row.app === 'admin')
      .map((row: { id: string }) => ({ ...row, no: row.id }))
  : JSON.parse(readFileSync(resolve(__dirname, '../../../../docs/reports/uxui-2026-10-14/acceptance-routes.json'), 'utf8'));
const inventory: Array<{ no: string; path: string; type: string; component: string }> = inventorySource
  .filter((row: { no: string }) => !process.env.UXUI_ROWS || process.env.UXUI_ROWS.split(',').includes(row.no));
const widths = (process.env.UXUI_WIDTHS || '1440,390,320').split(',').map(Number);
const concurrency = Number(process.env.UXUI_CONCURRENCY || 1);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid UXUI_CONCURRENCY');
if (!widths.every(width => Number.isInteger(width) && width >= 320 && width <= 3840)) throw new Error('Invalid UXUI_WIDTHS');
describe('UX/UI route inventory on isolated full API', () => {
  let h: DocumentsHarness, web: WebRuntime, world: DocumentsWorld;
  let populated: Awaited<ReturnType<typeof seedSystemUi>> | undefined;
  const results: any[] = [];
  const typographyFiles: Array<{ width: number; no: string; theme: string }> = [];
  const missingId = randomUUID();
  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    if (process.env.UXUI_POPULATED === '1') populated = await seedSystemUi(h, world);
    web = await startWeb(h);
  }, 180000);
  afterAll(async () => { await web?.close(); await h?.close(); });

  function target(row: typeof inventory[number]) {
    let path = row.path;
    let state = 'API-backed initial state';
    if (populated) {
      const ids: Record<string, string> = {
        '/suppliers/': populated.supplier.id, '/contacts/': populated.contact.id,
        '/inspections/': world.contracts.a.productId, '/after-sales/': populated.afterSales.id,
        '/external-finance-companies/': populated.externalFinance.id,
        '/expenses/': populated.expense.id, '/finance/equity/': populated.equity.id,
        '/other-income/': populated.income.id,
        '/assets/': path.endsWith('/edit') ? populated.asset.id : populated.activeAsset.id,
        '/purchase-orders/': populated.po.id,
      };
      for (const [prefix, id] of Object.entries(ids)) {
        if (path.startsWith(prefix) && /:id(?=\/|$)/.test(path)) return {
          path: path.replace(':id', id).replace(':receivingId', populated.receiving.id),
          state: 'populated synthetic detail/form',
        };
      }
      if (path === '/customer-access/:token') return { path: `/customer-access/${populated.portal.token}`, state: 'populated synthetic customer portal' };
      if (path.includes(':roomId?')) return { path: `/inbox/${populated.room.id}?zone=shop`, state: 'populated synthetic conversation' };
    }
    if (path === '/verify/contracts/:id') return { path: `/verify/contracts/${world.contracts.a.id}`, state: 'contract verification without hash' };
    if (path.includes(':categoryId')) path = path.replace(':categoryId', 'company').replace(':itemId', 'entities');
    if (path.includes(':roomId?')) path = '/inbox';
    if (/:id(?=\/|$)/.test(path)) {
      const id = path.startsWith('/customers/') ? world.customer.id
        : path.startsWith('/contracts/') ? world.contracts.a.id
          : path.startsWith('/products/') ? world.contracts.a.productId
            : path.startsWith('/users/') ? world.users.salesA.id : missingId;
      path = path.replace(/:id(?=\/|$)/, id);
      state = id === missingId ? 'missing-record recovery (populated flow belongs to domain suite)' : 'populated synthetic record';
    }
    if (path.includes(':token')) { path = path.replace(':token', 'uxui-expired-token'); state = 'invalid/expired token'; }
    if (path.includes(':receiptNumber')) { path = path.replace(':receiptNumber', 'RT-200001-99999'); state = 'missing receipt'; }
    if (path.includes(':number')) { path = path.replace(':number', 'PV-200001-99999'); state = 'missing voucher'; }
    if (path.includes(':identifier')) { path = path.replace(':identifier', 'PV-200001-99999'); state = 'legacy voucher missing-record recovery'; }
    path = path.replace(':receivingId', missingId).replace('*', 'uxui-not-found');
    if (typography && path.startsWith('/liff')) {
      // Ruling L: the audit measures the customer's page, not the cancelled-login card.
      state = 'synthetic LINE customer (seeded LIFF session + mocked LIFF API)';
    } else if (path.startsWith('/liff') || path.startsWith('/pay/') || ['/contract', '/history', '/early-payoff'].includes(path)) {
      path += '?login_error=true'; state = 'LINE login cancelled (no external credentials)';
    }
    if (!path.startsWith('/')) path = `/${path}`;
    return { path, state };
  }

  // Never throws: a collector failure (e.g. the canvas rejected a font) becomes the theme's `error` status.
  async function collectTypographyFacts(page: Page): Promise<{ facts?: unknown[]; collectorError?: string }> {
    try {
      // A root-error recovery reloads /landing, which drops the injected script — re-inject when missing.
      if (!await page.evaluate(() => typeof (window as any).__collectTypography === 'function')) await page.addScriptTag({ path: collectorPath });
      return { facts: await page.evaluate((exclude) => (window as any).__collectTypography({ exclude }) as unknown[], TYPOGRAPHY_EXCLUDE) };
    } catch (error) {
      return { collectorError: `collector: ${String(error).slice(0, 700)}` };
    }
  }

  function typographyRecord(row: typeof inventory[number], width: number, theme: string, item: any, targetPath: string, capture: ThemeCapture | undefined) {
    const base = { no: row.no, route: row.path, width, theme, role };
    const result = (status: TypographyStatus, extra: Record<string, unknown> = {}) => ({ ...base, status, facts: [] as unknown[], target: targetPath, finalPath: capture?.finalPath ?? null, ...extra });
    // Settings-inline panel never mounted because the page left the target pathname (fix round 1).
    if (item.panelRedirect) return result('redirected', { finalPath: item.panelRedirect });
    if (item.error) return result('error', { error: item.error });
    if (item.rootError) return result('error', { error: 'root error boundary (โหลดหน้าใหม่)' });
    if (item.pageErrors?.length) return result('error', { error: item.pageErrors.slice(0, 5).join(' | ').slice(0, 700) });
    if (!capture) return result('error', { error: `theme ${theme} was not captured` });
    if (capture.collectorError) return result('error', { error: capture.collectorError });
    if (pathnameOf(capture.finalPath) !== pathnameOf(targetPath)) return result('redirected');
    if (!capture.facts?.length || !capture.text.trim()) return result('empty');
    return { ...result('rendered'), facts: capture.facts };
  }

  function saveTypography(row: typeof inventory[number], width: number, theme: string, record: Record<string, unknown>) {
    saveArtifact('typography', `route-${row.no}-${width}-${theme}-${role}.json`, JSON.stringify(record));
    typographyFiles.push({ width, no: row.no, theme });
  }

  for (let offset = 0; offset < widths.length; offset += concurrency) {
    const batch = widths.slice(offset, offset + concurrency).map(width => ({ width, height: width >= 768 ? 1000 : width <= 320 ? 740 : 844 }));
    it(`records every inventory row at ${batch.map(viewport => viewport.width).join(', ')}px in light and dark, with settled API state and layout evidence`, async () => {
      const batchResults = await Promise.allSettled(batch.map(async viewport => {
      // A complete inventory can outlive a single access token on CI.
      const token = (await h.login(world.users[role].email, world.password)).token;
      const opened = await web.page(viewport);
      const page = opened.page;
      await page.addInitScript((accessToken) => {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('bc.sidebar.lastZone', 'shop');
      }, token);
      // Keep this safety boundary even if an external redirect is added later.
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (route.request().isNavigationRequest() && !['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
        return route.continue();
      });
      // After the catch-all on purpose: the newest matching handler runs first.
      if (typography) await routeLiffApi(page);
      await page.goto(`${web.origin}/landing`);
      await page.waitForTimeout(600);
      const apiErrors: any[] = [];
      page.on('response', response => {
        if (response.url().includes('/api/') && response.status() >= 400) apiErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
      });
      try {
        for (const row of inventory) {
          if (typography && row.type === 'document') {
            // Customer documents / paper are not audited: no navigation, no measurement, no screenshot.
            const item = { ...row, width: viewport.width, role, status: 'document', themes: [], typography: {} as Record<string, string> };
            for (const theme of THEMES) {
              saveTypography(row, viewport.width, theme, { no: row.no, route: row.path, width: viewport.width, theme, role, status: 'document', facts: [] });
              item.typography[theme] = 'document';
            }
            results.push(item);
            saveArtifact('uxui-pages', 'inventory-results.json', JSON.stringify(results, null, 2));
            console.log(`UXUI ${row.no} ${viewport.width} document ${row.path}`);
            continue;
          }
          const startError = opened.errors.length, startApi = apiErrors.length;
          const resolved = target(row);
          const item: any = { ...row, ...resolved, width: viewport.width, themes: [] };
          const captures: Partial<Record<string, ThemeCapture>> = {};
          try {
            if (!await page.locator('#root').count() || await page.getByRole('button', { name: 'โหลดหน้าใหม่', exact: true }).count()) {
              await page.goto(`${web.origin}/landing`);
              await page.waitForTimeout(600);
            }
            // pushState never re-runs addInitScript: seed the LIFF session right before EVERY /liff navigation.
            if (typography && resolved.path.startsWith('/liff')) await seedLiffSession(page);
            // Do not wait for URL equality: alias rows intentionally redirect.
            await page.evaluate((path) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, resolved.path);
            await page.waitForTimeout(600);
            await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
            await page.locator('[role="status"][aria-label="กำลังโหลด"]').first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
            // Redirects can mount a second, textless skeleton after networkidle.
            // Wait for actual page content instead of recording that intermediate state.
            await page.waitForFunction(() => {
              const main = document.querySelector<HTMLElement>('#main, main') ?? document.body;
              const loading = [...main.querySelectorAll('[data-slot="skeleton"], [role="status"][aria-label="กำลังโหลด"]')].some(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
              return Boolean(main.innerText.trim()) && !loading;
            }, undefined, { timeout: 30000 });
            await page.evaluate(() => document.fonts.ready);
            if (row.type === 'settings-inline') {
              const panel = page.locator(`[id="${row.path.split('#')[1]}"]`);
              if (typography) {
                try {
                  await panel.waitFor({ state: 'attached', timeout: 4000 });
                } catch (error) {
                  // A role without access to the settings page (salesA) is redirected away before the panel
                  // mounts: record that as `redirected` (typographyRecord), not as a harness error.
                  const current = new URL(page.url());
                  const currentPath = current.pathname + current.search + current.hash;
                  if (pathnameOf(currentPath) !== pathnameOf(resolved.path)) item.panelRedirect = item.finalPath = currentPath;
                  throw error;
                }
              } else await panel.waitFor({ state: 'attached', timeout: 4000 });
              await panel.scrollIntoViewIfNeeded();
              item.panelText = (await panel.innerText()).slice(0, 500);
            }
            for (const theme of THEMES) {
              await page.evaluate((value) => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
              await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
              // Read readiness and geometry in one browser callback for EACH theme.
              // A company/lazy-load remount can start after the earlier route wait.
              const readyMetrics = await page.waitForFunction(({ uiFont, uiFontPattern }) => {
                const main = document.querySelector('#main') ?? document.querySelector('main') ?? document.body;
                const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity !== '0' && !e.closest('[aria-hidden=true],[hidden]');
                if (/^กำลังโหลด[. …]*$/.test((main as HTMLElement).innerText.trim())) return false;
                if (!(main as HTMLElement).innerText.trim() || [...main.querySelectorAll('[data-slot="skeleton"], [role="status"][aria-label="กำลังโหลด"]')].some(visible)) return false;
                // Match Playwright's static screenshot treatment of finite animations.
                for (const animation of document.getAnimations()) {
                  if (animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
                }
                const headings = [...main.querySelectorAll('h1,h2')].filter(visible).map(e => ({ text: e.textContent?.trim(), width: e.getBoundingClientRect().width, right: e.getBoundingClientRect().right }));
                // Report wrappers include UI controls; only actual paper/editor subtrees
                // retain their legacy font. Inspect body to include portalled controls.
                const paper = '.voucher-sheet,.document-sheet,.bc-document,.template-paper,.font-sarabun,.mobile-receipt,.sticker,.print-stickers,.tiptap,svg,iframe';
                // UXUI_UI_FONT (default Noto Sans Thai) — the default reproduces /^["']?Noto Sans Thai["']?,/ exactly.
                const uiFontRe = new RegExp(`^["']?${uiFontPattern}["']?,`);
                const wrongFonts = [...document.body.querySelectorAll('*')].filter(e => visible(e) && !e.closest(paper) && [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) && !uiFontRe.test(getComputedStyle(e).fontFamily)).map(e => ({ tag: e.tagName, text: e.textContent?.slice(0, 80), font: getComputedStyle(e).fontFamily })).slice(0, 20);
                const fontLoaded = [...document.fonts].some(f => f.family.replace(/["']/g, '') === uiFont && f.status === 'loaded');
                const overflowingElements = [...main.querySelectorAll('*')].filter(e => visible(e) && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 30).map(e => ({ tag: e.tagName, className: e.getAttribute('class'), right: e.getBoundingClientRect().right, text: e.textContent?.slice(0, 100) }));
                const fields = [...main.querySelectorAll<HTMLInputElement>('input,select,textarea,button[role="combobox"],[data-slot="select-trigger"]')]
                  .filter(e => visible(e) && !e.closest(paper) && !['hidden', 'checkbox', 'radio', 'file', 'range', 'color'].includes(e.type))
                  .map(e => {
                    const box = e.getBoundingClientRect(), style = getComputedStyle(e);
                    const label = e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || [...e.labels || []].map(label => label.textContent?.trim()).join(' ');
                    return { tag: e.tagName, type: e.type, id: e.id, label, placeholder: e.getAttribute('placeholder'), height: box.height, width: box.width, x: box.x, y: box.y, fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily, className: e.className, disabled: e.disabled, readOnly: e.readOnly };
                  });
                const buttons = [...main.querySelectorAll('button')].filter(e => visible(e) && !e.closest(paper)).map(e => {
                  const box = e.getBoundingClientRect();
                  return { name: e.getAttribute('aria-label') || e.textContent?.trim() || e.getAttribute('title') || '', height: box.height, width: box.width, disabled: e.disabled };
                });
                return { fields, buttons, finalPath: location.pathname + location.search + location.hash, wrongFonts, fontLoaded, overflowingElements, overflow: document.documentElement.scrollWidth > innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, text: (main as HTMLElement).innerText.slice(0, 1200), headings, loading: [...main.querySelectorAll('[role="status"]')].filter(visible).map(e => e.getAttribute('aria-label') || e.textContent?.trim()) };
              }, { uiFont, uiFontPattern }, { timeout: 30000 });
              // Readiness alone is polled: overflowing geometry is returned immediately
              // and still fails below. Never wait for a bad layout to disappear.
              const metrics = await readyMetrics.jsonValue();
              await readyMetrics.dispose();
              const file = `route-${row.no}-${viewport.width}-${theme}.png`;
              const artifact = saveArtifact('uxui-pages', file, await page.screenshot({ animations: 'disabled' })).relativePath;
              item.themes.push({ theme, ...metrics, artifact });
              // After the screenshot so the evidence image never contains the collector's off-screen probe.
              // (`metrics` is always truthy here — waitForFunction resolves only on a truthy value; the check narrows the type.)
              if (typography && metrics) captures[theme] = { ...await collectTypographyFacts(page), finalPath: metrics.finalPath, text: metrics.text };
            }
            item.finalPath = new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash;
            item.apiErrors = apiErrors.slice(startApi);
            item.pageErrors = opened.errors.slice(startError).filter(e => e.startsWith('pageerror:'));
            item.rootError = await page.getByRole('button', { name: 'โหลดหน้าใหม่', exact: true }).count() > 0;
            item.status = item.rootError || item.pageErrors.length || item.themes.some((v: any) => v.overflow || !v.text.trim() || v.wrongFonts.length || !v.fontLoaded) ? 'REVIEW' : 'rendered';
          } catch (error) { item.status = 'REVIEW'; item.error = String(error).slice(0, 700); }
          if (typography) {
            // Written for every row × theme, whatever happened above (Ruling Y).
            item.role = role;
            item.typography = {};
            for (const theme of THEMES) {
              const record = typographyRecord(row, viewport.width, theme, item, resolved.path, captures[theme]);
              saveTypography(row, viewport.width, theme, record);
              item.typography[theme] = record.status;
            }
          }
          results.push(item);
          saveArtifact('uxui-pages', 'inventory-results.json', JSON.stringify(results, null, 2));
          console.log(`UXUI ${row.no} ${viewport.width} ${item.status} ${row.path}${typography ? ` typography ${THEMES.map(theme => item.typography[theme]).join('/')}` : ''}`);
        }
      } finally { await opened.context.close(); }
      // Keep every row's evidence even when one fails; triage the explicit REVIEW list.
      expect(results.filter(r => r.width === viewport.width)).toHaveLength(inventory.length);
      if (typography) {
        // Ruling Y: the audit run passes on complete evidence; REVIEW rows are listed by status, not failed.
        // An empty selection (typo in UXUI_ROWS / wrong inventory) must not pass vacuously.
        expect(inventory.length).toBeGreaterThan(0);
        // Distinct row × theme keys, not the number of saves: a duplicate save cannot hide a missing JSON.
        const written = new Set(typographyFiles.filter(f => f.width === viewport.width).map(f => `${f.no}-${f.theme}`));
        expect([...written].sort()).toEqual(inventory.flatMap(row => THEMES.map(theme => `${row.no}-${theme}`)).sort());
      } else {
        expect(results.filter(r => r.width === viewport.width && r.status === 'REVIEW').map(r => ({ no: r.no, path: r.path, error: r.error, pageErrors: r.pageErrors, rootError: r.rootError, blankThemes: r.themes?.filter((t: any) => !t.text.trim()).map((t: any) => t.theme), overflow: r.themes?.filter((t: any) => t.overflow).map((t: any) => t.theme) }))).toEqual([]);
      }
      expect(h.external.calls).toEqual([]);
      }));
      // Finish every viewport before afterAll closes their shared browser.
      // Otherwise one genuine REVIEW cascades into spurious closed-page rows.
      for (const result of batchResults) if (result.status === 'rejected') throw result.reason;
    }, 1800000);
  }
});
