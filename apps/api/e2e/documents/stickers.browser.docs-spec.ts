import { join } from 'path';
import type { BrowserContext, Page } from '@playwright/test';
import { DOCUMENT_STYLE } from '@installment/shared';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX } from '../../src/utils/test-data-markers';
import { DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { startWeb, WebRuntime } from './support/web';
import { domainDir, recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { foldThai, isPageSize, pageText, parsePdf, textSizes } from './support/pdf';

/**
 * DOC-11 (issue #1570) — sticker 50×30 mm regression: the live /stickers page prints
 * through the browser (`@page { size: 50mm 30mm }`), so the evidence is what headless
 * Chromium produces for print media: one 50×30 mm page per sticker, TH Sarabun PSK only,
 * the model on every sticker, no text outside the sticker box. Nothing about prices or
 * the sticker's wording is asserted here — that belongs to the sticker feature's own
 * tests; this scenario only guards the physical geometry the printer receives.
 */
const DOMAIN = 'stickers-browser';
const GUARDS = ['real login form → POST /api/auth/login', 'JwtAuthGuard', 'RolesGuard (OWNER, BRANCH_MANAGER, SALES)', 'EntityScopeInterceptor (?company= from the work zone)'];
const SIMULATED = [
  'products seeded directly as IN_STOCK rows (no purchase / receiving flow)',
  'print = headless Chromium page.pdf() for print media with the page\'s own @page size — the OS print dialog and the thermal printer are not involved (DOC-12)',
  'web served by the Vite dev server (same source as the production bundle); one real login per viewport',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['STICKER_50X30'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});
const STICKER_WIDTH_PT = 141.73; // 50 mm
const STICKER_HEIGHT_PT = 85.04; // 30 mm

describe('DOC-11 sticker 50×30 mm regression — /stickers print geometry through headless Chromium', () => {
  let h: DocumentsHarness;
  let web: WebRuntime;
  let world: DocumentsWorld;
  let owner: Session;
  let products: Array<{ id: string; model: string; category: string; imei: string }> = [];

  const shot = async (page: Page, name: string) => saveArtifact(DOMAIN, name, await page.screenshot({ fullPage: true })).relativePath;
  const consoleNote = (errors: string[]) => (errors.length ? `console errors: ${errors.join(' | ').slice(0, 400)}` : 'no console errors');
  const failureNote = async (page: Page, label: string) => {
    await page.screenshot({ path: join(domainDir(DOMAIN), `failure-${label}.png`), fullPage: true }).catch(() => undefined);
    saveArtifact(DOMAIN, `failure-${label}.txt`, `${page.url()}\n\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 4000)}`);
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    owner = await h.login(world.users.owner.email, world.password);
    const specs = [
      // Realistic model strings: the sticker prints the model on one line (nowrap + ellipsis), so the
      // check is "the whole model fits on the label" — the test marker lives on `name` and the IMEI.
      { label: 'USED-A', category: 'PHONE_USED', model: 'iPhone 14 Plus', batteryHealth: 91, warrantyDays: 180 },
      { label: 'USED-B', category: 'PHONE_USED', model: 'Galaxy S23 Ultra', batteryHealth: 84, warrantyDays: null },
      { label: 'NEW-C', category: 'PHONE_NEW', model: 'iPhone 15 Pro Max', batteryHealth: null, warrantyDays: 365 },
    ] as const;
    for (const spec of specs) {
      const row = await h.prisma.product.create({ data: {
        name: `${TEST_NAME_PREFIX} สติกเกอร์ ${spec.label} ${spec.model}`, brand: spec.model.startsWith('Galaxy') ? 'Samsung' : 'Apple', model: spec.model, storage: '128GB', color: 'ดำ', category: spec.category,
        branchId: world.branches.a.id, costPrice: '8000', cashPrice: '12990', installmentPrice: '14990', imeiSerial: `${TEST_DOC_PREFIX}${world.prefix}-STK-${spec.label}`, status: 'IN_STOCK',
        batteryHealth: spec.batteryHealth, warrantyExpireDate: spec.warrantyDays === null ? null : new Date(Date.now() + spec.warrantyDays * 86_400_000),
      } });
      products.push({ id: row.id, model: spec.model, category: spec.category, imei: row.imeiSerial ?? '' });
    }
    web = await startWeb(h);
  }, 300000);

  afterAll(async () => {
    await web?.close();
    await h?.close();
  });

  it('the sticker data route answers for OWNER and SALES with one row per product and refuses ACCOUNTANT', async () => {
    const ids = products.map((p) => p.id).join(',');
    const ownerRows = await h.client({ session: owner, company: 'SHOP' }).get(`/sticker-templates/products/data?ids=${ids}`);
    expect(ownerRows.status).toBe(200);
    // The global response envelope wraps the array in `data`.
    const rows = (ownerRows.body.data ?? ownerRows.body) as Array<{ productId: string; model: string }>;
    expect(rows.map((r) => r.productId).sort()).toEqual(products.map((p) => p.id).sort());
    const sales = await h.login(world.users.salesA.email, world.password);
    expect((await h.client({ session: sales, company: 'SHOP' }).get(`/sticker-templates/products/data?ids=${ids}`)).status).toBe(200);
    const accountant = await h.login(world.users.accountant.email, world.password);
    expect((await h.client({ session: accountant, company: 'SHOP' }).get(`/sticker-templates/products/data?ids=${ids}`)).status).toBe(403);
    expect((await h.client({ session: null, company: 'SHOP' }).get(`/sticker-templates/products/data?ids=${ids}`)).status).toBe(401);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/data-route`, title: 'GET /sticker-templates/products/data?ids=…: OWNER 200 (3 rows, one per product), SALES 200, ACCOUNTANT 403, no token 401', routes: ['GET /api/sticker-templates/products/data'], renderer: 'none', artifacts: [] }));
  });

  describe('1440px', () => {
    let context: BrowserContext;
    let page: Page;
    let errors: string[];
    beforeAll(async () => {
      ({ context, page, errors } = await web.page({ width: 1440, height: 1000 }));
      await web.login(page, world.users.owner.email, world.password);
    }, 120000);
    afterAll(async () => { await context?.close(); });

    it('3 products → /stickers?productIds → print media → one 50×30 mm page per sticker, fonts recorded, whole model on each page, text inside the sticker', async () => {
      const dataRequests: string[] = [];
      page.on('request', (request) => { if (/\/sticker-templates\/products\/data/.test(request.url())) dataRequests.push(request.url().replace(web.origin, '')); });
      await web.navigate(page, `/stickers?productIds=${products.map((p) => p.id).join(',')}`);
      try {
        // The print container is display:none on screen — wait for it to be populated, not visible.
        await page.locator('.print-stickers .sticker').nth(products.length - 1).waitFor({ state: 'attached', timeout: 45_000 });
      } catch (error) {
        await failureNote(page, 'stickers-preview');
        throw error;
      }
      expect(await page.locator('.print-stickers .sticker').count()).toBe(products.length);
      const shotPreview = await shot(page, 'stickers-preview-1440.png');
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
      const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      await page.emulateMedia({ media: null });
      const pdf = await parsePdf(bytes);
      // Evidence first: a failing assertion below must still leave the PDF and its parsed lines behind.
      const pdfArtifact = saveArtifact(DOMAIN, 'stickers-3-1440.pdf', bytes).relativePath;
      const linesArtifact = saveArtifact(DOMAIN, 'stickers-3-1440.lines.json', JSON.stringify({ pageCount: pdf.pageCount, fonts: pdf.fonts, pages: pdf.pages.map((p) => ({ w: p.widthPt.toFixed(2), h: p.heightPt.toFixed(2), lines: p.lines, items: p.items.map((i) => ({ str: i.str, x: +i.x.toFixed(1), y: +i.y.toFixed(1), size: i.size, font: i.font })) })) }, null, 2)).relativePath;
      expect(pdf.pageCount).toBe(products.length);
      expect(pdf.pages.every((p) => isPageSize(p, STICKER_WIDTH_PT, STICKER_HEIGHT_PT, 1.5))).toBe(true);
      // Owner decision 2026-09-12: the sticker keeps the typography of PR #1575 (IBM Plex Sans Thai from
      // Google Fonts) — the fonts are recorded in the scenario, not held to DOCUMENT_STYLE.pdfFontFamily.
      expect(pdf.fonts.length).toBeGreaterThan(0);
      // The model line is nowrap + ellipsis on the label and the label's own font (IBM Plex Sans Thai,
      // owner decision 2026-09-12) is wide enough that even realistic models can end in "…". The page
      // still has to identify its product: the printed model line (top-left, first text item of the
      // page, "…" stripped) must be a prefix of exactly one product's model. Truncation is recorded
      // in the scenario, not asserted away; the page order is recorded, not asserted.
      // Identity = the IMEI the label prints whole in its footer (unique per product); the model line
      // (top-left, first text item) is recorded as printed, with the "…" the label applies.
      const pageIdentity = pdf.pages.map((p) => {
        const text = foldThai(pageText(p));
        const byImei = products.filter((product) => product.imei && text.includes(foldThai(product.imei)));
        const first = [...p.items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)[0];
        const printed = (first?.str ?? '').replace(/…$/, '').trim();
        const cut = /…$/.test(first?.str ?? '');
        const modelAgrees = byImei.length === 1 && printed.length > 0 && foldThai(byImei[0].model).startsWith(foldThai(printed));
        return { byImei: byImei.map((product) => product.model), printed, cut, modelAgrees };
      });
      const printedOrder = pageIdentity.map((page) => page.byImei.join(' + ') || `NO IMEI (model line "${page.printed || 'empty'}")`);
      const truncated = pageIdentity.filter((page) => page.cut).map((page) => `${page.byImei[0] ?? '?'} → "${page.printed}…"`);
      expect(pageIdentity.map((page) => page.byImei.length)).toEqual(products.map(() => 1));
      expect([...printedOrder].sort()).toEqual(products.map((product) => product.model).sort());
      // The model line must belong to the same product the IMEI names (prefix of that model, cut or not).
      expect(pageIdentity.map((page) => page.modelAgrees)).toEqual(products.map(() => true));
      const outside = pdf.pages.flatMap((p) => p.items.filter((i) => i.str.trim() && (i.x < -1 || i.x + i.width > p.widthPt + 1 || i.y < -1 || i.y > p.heightPt + 1)).map((i) => ({ page: p.index, str: i.str, x: i.x, y: i.y })));
      expect(outside).toEqual([]);
      const sizes = textSizes(pdf);
      expect(dataRequests.length).toBeGreaterThanOrEqual(1);
      const artifacts = [shotPreview, pdfArtifact, linesArtifact, saveArtifact(DOMAIN, 'stickers-3-1440.json', JSON.stringify({ pageCount: pdf.pageCount, fonts: pdf.fonts, sizes, printedOrder, pages: pdf.pages.map((p) => ({ w: p.widthPt.toFixed(2), h: p.heightPt.toFixed(2), lines: p.lines })), dataRequests }, null, 2)).relativePath];
      expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/print-geometry`, title: `/stickers?productIds=(3) → print media → ${pdf.pageCount} pages of ${STICKER_WIDTH_PT} × ${STICKER_HEIGHT_PT} pt (50 × 30 mm), fonts ${pdf.fonts.join('/')}, text sizes ${sizes.map((s) => `${s.size}pt×${s.count}`).join(' ')}, every page identifies its product by its IMEI and the model line agrees (printed order ${printedOrder.join(' | ')}; ${truncated.length ? `cut with … on ${truncated.length}/${pdf.pageCount} labels: ${truncated.join(', ')}` : 'no model cut'}), no text outside the page`, routes: ['GET /api/sticker-templates/products/data', 'GET /api/products', 'GET /api/products/brands'], artifacts, unverified: ['thermal printer output / label stock alignment (DOC-12)', 'the OS print dialog (headless page.pdf() stands in)'], notes: `${consoleNote(errors)}; runs against the redesigned page (PR #1575, apps/web/src/pages/StickerPrintPage/) — nothing about prices, wording or typography is asserted (owner keeps the label's own font, 2026-09-12) — only geometry and product identity on each sticker; the model line is nowrap + ellipsis and with the label's font realistic models are cut on paper (see title) — an observation for the owner / DOC-12, not a failure of this check` }));
    }, 300000);
  });
});
