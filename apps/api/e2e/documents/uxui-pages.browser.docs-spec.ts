/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { startDocumentsApp, DocumentsHarness } from './support/harness';
import { seedDocumentsWorld, DocumentsWorld } from './support/fixtures';
import { startWeb, WebRuntime } from './support/web';
import { saveArtifact } from './support/artifacts';
import { seedSystemUi } from '../ui-fields/system-fixtures';

// Route/state inventory, not a replacement for the domain transaction suites.
// Real API reads; synthetic records; no mutation or external messages.
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
    if (path.startsWith('/liff') || path.startsWith('/pay/') || ['/contract', '/history', '/early-payoff'].includes(path)) {
      path += '?login_error=true'; state = 'LINE login cancelled (no external credentials)';
    }
    if (!path.startsWith('/')) path = `/${path}`;
    return { path, state };
  }

  for (let offset = 0; offset < widths.length; offset += concurrency) {
    const batch = widths.slice(offset, offset + concurrency).map(width => ({ width, height: width >= 768 ? 1000 : width <= 320 ? 740 : 844 }));
    it(`records every inventory row at ${batch.map(viewport => viewport.width).join(', ')}px in light and dark, with settled API state and layout evidence`, async () => {
      const batchResults = await Promise.allSettled(batch.map(async viewport => {
      // A complete inventory can outlive a single access token on CI.
      const token = (await h.login(world.users.owner.email, world.password)).token;
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
      await page.goto(`${web.origin}/landing`);
      await page.waitForTimeout(600);
      const apiErrors: any[] = [];
      page.on('response', response => {
        if (response.url().includes('/api/') && response.status() >= 400) apiErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
      });
      try {
        for (const row of inventory) {
          const startError = opened.errors.length, startApi = apiErrors.length;
          const resolved = target(row);
          const item: any = { ...row, ...resolved, width: viewport.width, themes: [] };
          try {
            if (!await page.locator('#root').count() || await page.getByRole('button', { name: 'โหลดหน้าใหม่', exact: true }).count()) {
              await page.goto(`${web.origin}/landing`);
              await page.waitForTimeout(600);
            }
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
              await panel.waitFor({ state: 'attached', timeout: 4000 });
              await panel.scrollIntoViewIfNeeded();
              item.panelText = (await panel.innerText()).slice(0, 500);
            }
            for (const theme of ['light', 'dark']) {
              await page.evaluate((value) => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
              await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
              // Read readiness and geometry in one browser callback for EACH theme.
              // A company/lazy-load remount can start after the earlier route wait.
              const readyMetrics = await page.waitForFunction(() => {
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
                const wrongFonts = [...document.body.querySelectorAll('*')].filter(e => visible(e) && !e.closest(paper) && [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) && !getComputedStyle(e).fontFamily.includes('Noto Sans Thai Looped')).map(e => ({ tag: e.tagName, text: e.textContent?.slice(0, 80), font: getComputedStyle(e).fontFamily })).slice(0, 20);
                const fontLoaded = [...document.fonts].some(f => f.family.includes('Noto Sans Thai Looped') && f.status === 'loaded');
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
              }, undefined, { timeout: 30000 });
              // Readiness alone is polled: overflowing geometry is returned immediately
              // and still fails below. Never wait for a bad layout to disappear.
              const metrics = await readyMetrics.jsonValue();
              await readyMetrics.dispose();
              const file = `route-${row.no}-${viewport.width}-${theme}.png`;
              const artifact = saveArtifact('uxui-pages', file, await page.screenshot({ animations: 'disabled' })).relativePath;
              item.themes.push({ theme, ...metrics, artifact });
            }
            item.finalPath = new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash;
            item.apiErrors = apiErrors.slice(startApi);
            item.pageErrors = opened.errors.slice(startError).filter(e => e.startsWith('pageerror:'));
            item.rootError = await page.getByRole('button', { name: 'โหลดหน้าใหม่', exact: true }).count() > 0;
            item.status = item.rootError || item.pageErrors.length || item.themes.some((v: any) => v.overflow || !v.text.trim() || v.wrongFonts.length || !v.fontLoaded) ? 'REVIEW' : 'rendered';
          } catch (error) { item.status = 'REVIEW'; item.error = String(error).slice(0, 700); }
          results.push(item);
          saveArtifact('uxui-pages', 'inventory-results.json', JSON.stringify(results, null, 2));
          console.log(`UXUI ${row.no} ${viewport.width} ${item.status} ${row.path}`);
        }
      } finally { await opened.context.close(); }
      // Keep every row's evidence even when one fails; triage the explicit REVIEW list.
      expect(results.filter(r => r.width === viewport.width)).toHaveLength(inventory.length);
      expect(results.filter(r => r.width === viewport.width && r.status === 'REVIEW').map(r => ({ no: r.no, path: r.path, error: r.error, pageErrors: r.pageErrors, rootError: r.rootError, blankThemes: r.themes?.filter((t: any) => !t.text.trim()).map((t: any) => t.theme), overflow: r.themes?.filter((t: any) => t.overflow).map((t: any) => t.theme) }))).toEqual([]);
      expect(h.external.calls).toEqual([]);
      }));
      // Finish every viewport before afterAll closes their shared browser.
      // Otherwise one genuine REVIEW cascades into spurious closed-page rows.
      for (const result of batchResults) if (result.status === 'rejected') throw result.reason;
    }, 1800000);
  }
});
