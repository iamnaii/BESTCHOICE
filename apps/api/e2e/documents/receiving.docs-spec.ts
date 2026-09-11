/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserContext, Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { TRADE_IN_DECLARATION_TEXT, TRADE_IN_DECLARATION_VERSION } from '@installment/shared';
import { thaiBahtText } from '../../src/utils/thai-baht-text.util';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld, SIGNATURE_PNG, WorldUser } from './support/fixtures';
import { createLoginPacer } from './support/payroll-fixtures';
import { mintExpiredAdminToken, setExportEnabled } from './support/other-income-fixtures';
import {
  attachBranchToShop, checksummedNationalId, createSupplier, dispositionFilename, expectedBuybackJournal, expectedCreditJournal, GR_NUMBER, imeiFactory,
  markMainWarehouse, PO_NUMBER, poItemBody, PoItemSpec, receivingExpectation, ReceivingUnit, seedTradeInValuation, sellerEvidence, SHOP_USED_INVENTORY, SupplierRow,
  valuationBand, VOUCHER_NUMBER,
} from './support/receiving-fixtures';
import { recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { foldThai, isA4, pageContaining, parsePdf, ParsedPdf } from './support/pdf';
import { startWeb, WebRuntime } from './support/web';

/**
 * DOC-02 (issue #1561): receiving documents through the real API on the
 * disposable database — purchase orders (OWNER → ORDERED, BRANCH_MANAGER →
 * DRAFT → OWNER approve), goods receiving with PASS/REJECT units, partial and
 * full receipt, the ceiling / duplicate-IMEI / empty-batch refusals, the
 * products that receiving creates (and the journal it must NOT create), the
 * ใบรับของ (goods receipt) printed from the real admin web app with Chromium
 * print media, and the trade-in side: quick-buy (BUYBACK, CASH / TRANSFER) with
 * the real ShopTradeIn journal and the puppeteer ใบสำคัญจ่ายเงิน (ORIGINAL then
 * COPY), plus an EXCHANGE trade-in that ends in ใบรับเครื่องเทิร์น with the
 * trade-in credit journal.
 *
 * Money and rules are the system's own — the fixture only states what the real
 * services must leave behind.
 */
const DOMAIN = 'receiving';
const GUARDS = [
  'CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard',
  'RolesGuard (PO create/receive OWNER/BRANCH_MANAGER; approve OWNER; receiving read + FINANCE_MANAGER/ACCOUNTANT; quick-buy OWNER/BRANCH_MANAGER/SALES; appraise/accept/voucher OWNER/BRANCH_MANAGER; voucher.pdf every staff role)',
  'BranchGuard (branchId in body)', 'EntityScopeGuard(SHOP) on quick-buy', 'ExportEnabledGuard on voucher.pdf', 'AuditInterceptor',
  'DTO validators (ArrayMinSize(1) receiving units, IMEI ^\\d{15}$, declaration version, PASS|REJECT)',
  'po-receiving Serializable tx: PO status gate, ceiling re-read (จำนวนรับเกิน), duplicate IMEI in batch / in system, GR number',
  'trade-in evidence rules (ชื่อผู้ขาย, บัตร 13 หลัก checksum, โทร 9–10 หลัก, ที่อยู่, IMEI หรือ Serial), ±15% valuation band, per-branch SHOP cash account (fail-closed), quick-buy requestId idempotency',
];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded by the harness, never sent',
  'supplier and valuation table are synthetic prisma rows carrying the test markers; world branch A is flagged main warehouse and attached to SHOP for this run',
  'seller signature is the 1×1 PNG data URL of the world fixtures',
  'ใบรับของ is a browser document captured with Chromium print-media page.pdf() (window.print() itself is not capturable); the voucher is the server renderer (puppeteer)',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['GOODS_RECEIPT'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

type PoItem = { id: string; brand: string | null; model: string | null; quantity: number; receivedQty: number; unitPrice: string };
type Po = { id: string; poNumber: string; status: string; supplierId: string; items: PoItem[] };
type Receiving = { id: string; grNumber: string; poId: string; notes: string | null; createdAt: string; po: { id: string; poNumber: string; supplier: { id: string; name: string } }; receivedBy: { id: string; name: string }; items: Array<{ id: string; status: 'PASS' | 'REJECT'; imeiSerial: string | null; serialNumber: string | null; rejectReason: string | null; defectReason: string | null; poItem: { id: string; brand: string; model: string; storage: string | null; color: string | null; category: string | null } | null; product: { id: string; status: string; branchId: string | null; imeiSerial: string | null } | null }> };
type ReceiveResult = { receivingId: string; grNumber: string; poId: string; status: string; passed: number; rejected: number; products: Array<{ id: string; status: string; costPrice: string; branchId: string; category: string; imeiSerial: string | null }>; mainWarehouse: string };

describe('DOC-02 goods receipts and trade-in vouchers — real purchase orders, real receiving, real trade-in journal, real renderers', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let web: WebRuntime | null = null;
  let owner: Session, branchManagerA: Session, salesA: Session, salesB: Session, accountant: Session, financeManager: Session;
  let supplier: SupplierRow;
  let shopCompany: { id: string; nameTh: string };
  const pace = createLoginPacer();
  const imei = imeiFactory();
  let imeiCounter = 0;
  const nextImei = () => imei(++imeiCounter);
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const ORDER_DATE = iso(today);
  const EXPECTED_DATE = iso(new Date(today.getTime() + 86_400_000));
  const BRAND = 'ทดสอบระบบ';
  const VALUATION = { brand: BRAND, model: 'iPhone 15', storage: '128GB', condition: 'A' as const, basePrice: 10000 };

  // Shared across tests (filled by the first one).
  let ownerPo: Po;
  let firstReceiving: ReceiveResult;
  let longReceiving: ReceiveResult;
  let longPo: Po;
  let bmSession: { context: BrowserContext; page: Page; errors: string[]; runtime: WebRuntime } | null = null;

  const api = (session: Session | null, company?: 'SHOP' | 'FINANCE' | null) => h.client({ session, company });
  const data = (response: { body: any }) => response.body?.data;
  const expectStatus = (response: { status: number; body: any }, code: number, label: string) => {
    if (response.status !== code) throw new Error(`${label}: expected ${code}, got ${response.status} ${JSON.stringify(response.body).slice(0, 600)}`);
  };
  const message = (response: { body: any }) => {
    const raw = response.body?.message ?? response.body?.error?.message ?? response.body?.errors ?? response.body;
    return Array.isArray(raw) ? raw.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join(' | ') : String(typeof raw === 'string' ? raw : JSON.stringify(raw));
  };

  const createPo = async (session: Session, items: PoItemSpec[], notes?: string) => {
    const response = await api(session).post('/purchase-orders', { supplierId: supplier.id, orderDate: ORDER_DATE, expectedDate: EXPECTED_DATE, notes: notes ?? `ข้อมูลทดสอบระบบ — ลบได้ ${world.prefix}`, items: items.map(poItemBody) });
    expectStatus(response, 201, 'create PO');
    return data(response) as Po;
  };
  const readPo = async (id: string): Promise<Po> => { const response = await api(owner).get(`/purchase-orders/${id}`); expectStatus(response, 200, 'read PO'); return data(response); };
  const receive = async (session: Session, poId: string, units: ReceivingUnit[], notes?: string) => api(session).post(`/purchase-orders/${poId}/goods-receiving`, { items: units, notes });
  const readReceiving = async (session: Session, poId: string, receivingId: string, company?: 'SHOP' | 'FINANCE' | null) => api(session, company).get(`/purchase-orders/${poId}/goods-receivings/${receivingId}`);
  const journalTouching = (needles: string[]) => h.prisma.journalEntry.count({ where: { OR: needles.flatMap((needle) => [{ referenceId: { contains: needle } }, { description: { contains: needle } }]) } });
  const journalFor = (tradeInId: string) => h.prisma.journalEntry.findMany({ where: { referenceId: `tradein:${tradeInId}` }, include: { lines: { orderBy: { accountCode: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  const asLines = (entry: { lines: Array<{ accountCode: string; debit: unknown; credit: unknown }> }) => entry.lines.map((line) => ({ accountCode: line.accountCode, debit: Number(line.debit).toFixed(2), credit: Number(line.credit).toFixed(2) })).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const sorted = (lines: Array<{ accountCode: string; debit: string; credit: string }>) => [...lines].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const fontsAreSarabun = (pdf: ParsedPdf) => pdf.fonts.filter((font) => !font.startsWith('THSarabunPSK'));
  const textOf = (pdf: ParsedPdf) => foldThai(pdf.pages.map((page) => page.text).join('\n'));
  const insideBounds = (pdf: ParsedPdf) => {
    for (const page of pdf.pages) {
      const outside = page.items.filter((item) => item.str.trim() && (item.x < -1 || item.x > page.widthPt + 1 || item.y < -1 || item.y > page.heightPt + 1));
      expect(outside.map((item) => `${item.str}@${item.x.toFixed(1)},${item.y.toFixed(1)}`)).toEqual([]);
    }
  };

  // Browser helpers — real login once per context, in-app routing afterwards (POST /auth/refresh is throttled).
  const ensureWeb = async () => { if (!web) web = await startWeb(h); return web; };
  const openAs = async (user: WorldUser, path: string, viewport = { width: 1440, height: 900 }) => {
    const runtime = await ensureWeb();
    const { context, page, errors } = await runtime.page(viewport);
    await pace();
    await runtime.login(page, user.email, user.password);
    await runtime.navigate(page, path);
    return { context, page, errors, runtime };
  };
  const waitForText = async (page: Page, text: string, label: string, timeout = 60_000) => {
    try {
      await page.getByText(text).first().waitFor({ state: 'visible', timeout });
    } catch (error) {
      saveArtifact(DOMAIN, `failure-${label}.png`, await page.screenshot({ fullPage: true }).catch(() => Buffer.alloc(0)));
      const bodyText = await page.locator('body').innerText().catch(() => '');
      saveArtifact(DOMAIN, `failure-${label}.txt`, `${page.url()}\n\n${bodyText.slice(0, 4000)}`);
      throw new Error(`${label}: "${text}" not visible at ${page.url()} — ${String((error as Error).message).split('\n')[0]}`);
    }
  };
  const printToPdf = async (page: Page, label: string) => {
    await page.evaluate(() => (document as any).fonts.ready);
    await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0, undefined, { timeout: 15_000 }).catch(() => undefined);
    const fontLoaded = await page.evaluate(() => (document as any).fonts.check('16pt "TH Sarabun PSK"'));
    await page.emulateMedia({ media: 'print' });
    // Printing in the same frame as the media switch yields a PDF with layout but no text runs (DOC-03 finding).
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const printMediaShot = saveArtifact(DOMAIN, `${label}.print-media.png`, await page.screenshot({ fullPage: true })).relativePath;
    try {
      const bytes = Buffer.from(await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true }));
      const pdf = await parsePdf(bytes);
      const artifact = saveArtifact(DOMAIN, `${label}.pdf`, bytes).relativePath;
      const textItems = pdf.pages.reduce((count, p) => count + p.items.filter((item) => item.str.trim()).length, 0);
      if (textItems === 0) throw new Error(`print PDF of ${label} contains no text (font loaded: ${fontLoaded})`);
      return { bytes, pdf, artifact, fontLoaded, printMediaShot };
    } finally {
      await page.emulateMedia({ media: 'screen' });
    }
  };
  const shots = async (page: Page, label: string): Promise<string[]> => {
    const wide = saveArtifact(DOMAIN, `${label}-1440.png`, await page.screenshot({ fullPage: true })).relativePath;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const narrow = saveArtifact(DOMAIN, `${label}-390.png`, await page.screenshot({ fullPage: true })).relativePath;
    await page.setViewportSize({ width: 1440, height: 900 });
    return [wide, narrow];
  };
  const waitEnabled = async (locator: import('@playwright/test').Locator, enabled: boolean, label: string, timeout = 30_000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if ((await locator.isEnabled().catch(() => !enabled)) === enabled) return;
      if (Date.now() > deadline) throw new Error(`${label}: button did not become ${enabled ? 'enabled' : 'disabled'} within ${timeout} ms`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  const pageErrors = (errors: string[]) => errors.filter((error) => error.startsWith('pageerror'));
  const consoleNote = (errors: string[]) => (errors.length ? `console errors: ${errors.join(' | ').slice(0, 500)}` : 'no console errors');

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    supplier = await createSupplier(h.prisma, world, { hasVat: true });
    await markMainWarehouse(h.prisma, world.branches.a.id);
    const { shopCompanyId } = await attachBranchToShop(h.prisma, world.branches.a.id);
    shopCompany = await h.prisma.companyInfo.findUniqueOrThrow({ where: { id: shopCompanyId }, select: { id: true, nameTh: true } });
    await seedTradeInValuation(h.prisma, VALUATION);
    for (const [key, user] of [['owner', world.users.owner], ['branchManagerA', world.users.branchManagerA], ['salesA', world.users.salesA], ['salesB', world.users.salesB], ['accountant', world.users.accountant], ['financeManager', world.users.financeManager]] as const) {
      await pace();
      const session = await h.login(user.email, user.password);
      if (key === 'owner') owner = session; else if (key === 'branchManagerA') branchManagerA = session; else if (key === 'salesA') salesA = session; else if (key === 'salesB') salesB = session; else if (key === 'accountant') accountant = session; else financeManager = session;
    }
  }, 240000);

  afterAll(async () => {
    if (bmSession) await bmSession.context.close().catch(() => undefined);
    if (web) await web.close();
    await setExportEnabled(h.prisma, null).catch(() => undefined);
    await h.close();
  });

  it('purchase orders and goods receiving: OWNER PO is ORDERED at once, BM PO waits for OWNER approval; PASS units become IN_STOCK products in the main warehouse at PO cost, REJECT units do not; partial then full receipt; ceiling, duplicate-IMEI and empty-batch refusals; no journal entry', async () => {
    const routes: string[] = [];
    const items: PoItemSpec[] = [
      { brand: BRAND, model: 'iPhone 15', color: 'Black', storage: '128GB', category: 'PHONE_NEW', quantity: 3, unitPrice: 25000 },
      { brand: BRAND, model: 'Galaxy A55', color: 'Navy', storage: '256GB', category: 'PHONE_NEW', quantity: 2, unitPrice: 8000 },
      { brand: BRAND, model: '20W USB-C', category: 'ACCESSORY', accessoryType: 'ชุดชาร์จ', accessoryBrand: `${BRAND} Apple`, quantity: 2, unitPrice: 500 },
    ];

    // OWNER-created PO skips the approval ceremony.
    ownerPo = await createPo(owner, items);
    routes.push('POST /purchase-orders');
    expect(ownerPo.poNumber).toMatch(PO_NUMBER);
    expect(ownerPo.status).toBe('ORDERED');
    expect(ownerPo.items).toHaveLength(3);
    const byModel = (model: string) => ownerPo.items.find((item) => item.model === model)!;
    const iphone = byModel('iPhone 15'), galaxy = byModel('Galaxy A55'), charger = byModel('20W USB-C');

    // BRANCH_MANAGER PO stays DRAFT: cannot be received, cannot self-approve, OWNER approval orders it.
    const bmPo = await createPo(branchManagerA, [{ brand: BRAND, model: 'Redmi Note 13', storage: '128GB', category: 'PHONE_NEW', quantity: 1, unitPrice: 5500 }]);
    expect(bmPo.status).toBe('DRAFT');
    const draftReceive = await receive(branchManagerA, bmPo.id, [{ poItemId: bmPo.items[0].id, imeiSerial: nextImei(), status: 'PASS' }]);
    expectStatus(draftReceive, 400, 'receive DRAFT PO');
    expect(message(draftReceive)).toContain('ไม่อยู่ในสถานะที่สามารถรับสินค้าได้');
    const selfApprove = await api(branchManagerA).post(`/purchase-orders/${bmPo.id}/approve`, {});
    expectStatus(selfApprove, 403, 'BM approve own PO');
    const approve = await api(owner).post(`/purchase-orders/${bmPo.id}/approve`, {});
    expectStatus(approve, 201, 'OWNER approve PO');
    routes.push('POST /purchase-orders/:id/approve');
    expect(data(approve).status).toBe('ORDERED');

    // Empty batch is refused by the DTO before any receiving row exists.
    const empty = await receive(branchManagerA, ownerPo.id, []);
    expectStatus(empty, 400, 'empty receiving');

    // First receiving: 2 iPhones PASS, 1 iPhone REJECT (screen), 1 Galaxy, both chargers (no IMEI).
    const rejectedImei = nextImei();
    const passImeis = [nextImei(), nextImei()];
    const galaxyImei = nextImei();
    const firstUnits: ReceivingUnit[] = [
      { poItemId: iphone.id, imeiSerial: passImeis[0], status: 'PASS' },
      { poItemId: iphone.id, imeiSerial: passImeis[1], status: 'PASS' },
      { poItemId: iphone.id, imeiSerial: rejectedImei, status: 'REJECT', defectReason: 'SCREEN', rejectReason: `${BRAND} จอแตก มีรอยร้าวมุมซ้าย` },
      { poItemId: galaxy.id, imeiSerial: galaxyImei, status: 'PASS' },
      { poItemId: charger.id, serialNumber: `TEST-CHG-${world.prefix}-1`, status: 'PASS' },
      { poItemId: charger.id, serialNumber: `TEST-CHG-${world.prefix}-2`, status: 'PASS' },
    ];
    const expectation = receivingExpectation(firstUnits);
    const first = await receive(branchManagerA, ownerPo.id, firstUnits, `ข้อมูลทดสอบระบบ — ลบได้ รับรอบแรก ${world.prefix}`);
    expectStatus(first, 201, 'first receiving');
    routes.push('POST /purchase-orders/:id/goods-receiving');
    firstReceiving = data(first);
    expect(firstReceiving.grNumber).toMatch(GR_NUMBER);
    expect(firstReceiving.status).toBe('PARTIALLY_RECEIVED');
    expect(firstReceiving.passed).toBe(expectation.passed);
    expect(firstReceiving.rejected).toBe(expectation.rejected);
    expect(firstReceiving.mainWarehouse).toBe(world.branches.a.name);
    expect(firstReceiving.products).toHaveLength(expectation.passed);
    for (const product of firstReceiving.products) {
      expect(product.status).toBe('IN_STOCK');
      expect(product.branchId).toBe(world.branches.a.id);
    }

    // Products in the database: cost = PO unit price, category from the PO line, supplier/PO links, IMEIs as received; the rejected IMEI never became a product.
    const products = await h.prisma.product.findMany({ where: { poId: ownerPo.id, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    expect(products).toHaveLength(expectation.passed);
    const costs = products.map((product) => `${product.category}:${Number(product.costPrice).toFixed(2)}`).sort();
    expect(costs).toEqual(['ACCESSORY:500.00', 'ACCESSORY:500.00', 'PHONE_NEW:25000.00', 'PHONE_NEW:25000.00', 'PHONE_NEW:8000.00'].sort());
    expect(products.every((product) => product.supplierId === supplier.id && product.branchId === world.branches.a.id && product.status === 'IN_STOCK')).toBe(true);
    expect(products.map((product) => product.imeiSerial).filter(Boolean).sort()).toEqual([...passImeis, galaxyImei].sort());
    expect(await h.prisma.product.count({ where: { imeiSerial: rejectedImei, deletedAt: null } })).toBe(0);
    expect(products.filter((product) => product.category === 'ACCESSORY').every((product) => product.imeiSerial === null && product.name.includes('ชุดชาร์จ'))).toBe(true);
    expect(products.every((product) => product.name.includes(BRAND))).toBe(true);

    // PO lines carry the received quantities.
    let po = await readPo(ownerPo.id);
    routes.push('GET /purchase-orders/:id');
    expect(po.status).toBe('PARTIALLY_RECEIVED');
    expect(Object.fromEntries(po.items.map((item) => [item.model, item.receivedQty]))).toEqual({ 'iPhone 15': 2, 'Galaxy A55': 1, '20W USB-C': 2 });

    // Ceiling: one iPhone left, receiving two is refused as a whole (no partial row).
    const over = await receive(branchManagerA, ownerPo.id, [{ poItemId: iphone.id, imeiSerial: nextImei(), status: 'PASS' }, { poItemId: iphone.id, imeiSerial: nextImei(), status: 'PASS' }]);
    expectStatus(over, 400, 'over-receipt');
    expect(message(over)).toContain('จำนวนรับเกิน');
    // Duplicate IMEI inside the batch and against an existing product.
    const dupImei = nextImei();
    const dupInBatch = await receive(branchManagerA, ownerPo.id, [{ poItemId: iphone.id, imeiSerial: dupImei, status: 'PASS' }, { poItemId: galaxy.id, imeiSerial: dupImei, status: 'PASS' }]);
    expectStatus(dupInBatch, 400, 'duplicate IMEI in batch');
    expect(message(dupInBatch)).toContain('IMEI ซ้ำ');
    const dupInSystem = await receive(branchManagerA, ownerPo.id, [{ poItemId: iphone.id, imeiSerial: passImeis[0], status: 'PASS' }]);
    expectStatus(dupInSystem, 400, 'duplicate IMEI in system');
    expect(message(dupInSystem)).toContain('IMEI ซ้ำ');
    // Unknown PO line.
    const unknownLine = await receive(branchManagerA, ownerPo.id, [{ poItemId: '00000000-0000-4000-8000-000000000000', imeiSerial: nextImei(), status: 'PASS' }]);
    expectStatus(unknownLine, 404, 'unknown PO line');
    // Nothing above left a receiving behind.
    expect(await h.prisma.goodsReceiving.count({ where: { poId: ownerPo.id } })).toBe(1);
    po = await readPo(ownerPo.id);
    expect(Object.fromEntries(po.items.map((item) => [item.model, item.receivedQty]))).toEqual({ 'iPhone 15': 2, 'Galaxy A55': 1, '20W USB-C': 2 });

    // Second receiving completes the PO.
    const second = await receive(owner, ownerPo.id, [{ poItemId: iphone.id, imeiSerial: nextImei(), status: 'PASS' }, { poItemId: galaxy.id, imeiSerial: nextImei(), status: 'PASS' }]);
    expectStatus(second, 201, 'second receiving');
    const secondReceiving: ReceiveResult = data(second);
    expect(secondReceiving.grNumber).toMatch(GR_NUMBER);
    expect(secondReceiving.grNumber).not.toBe(firstReceiving.grNumber);
    expect(secondReceiving.status).toBe('FULLY_RECEIVED');
    po = await readPo(ownerPo.id);
    expect(po.status).toBe('FULLY_RECEIVED');
    expect(po.items.every((item) => item.receivedQty === item.quantity)).toBe(true);
    expect(await h.prisma.product.count({ where: { poId: ownerPo.id, deletedAt: null } })).toBe(7);
    // Receiving the completed PO is refused.
    const afterFull = await receive(owner, ownerPo.id, [{ poItemId: iphone.id, imeiSerial: nextImei(), status: 'PASS' }]);
    expectStatus(afterFull, 400, 'receive FULLY_RECEIVED PO');

    // The receiving document as the print page reads it.
    const read = await readReceiving(branchManagerA, ownerPo.id, firstReceiving.receivingId);
    expectStatus(read, 200, 'read receiving');
    routes.push('GET /purchase-orders/:id/goods-receivings/:receivingId');
    const doc: Receiving = data(read);
    expect(doc.grNumber).toBe(firstReceiving.grNumber);
    expect(doc.po.poNumber).toBe(ownerPo.poNumber);
    expect(doc.po.supplier.name).toBe(supplier.name);
    expect(doc.receivedBy.id).toBe(world.users.branchManagerA.id);
    expect(doc.items).toHaveLength(firstUnits.length);
    const rejected = doc.items.find((item) => item.status === 'REJECT')!;
    expect(rejected.imeiSerial).toBe(rejectedImei);
    expect(rejected.defectReason).toBe('SCREEN');
    expect(rejected.rejectReason).toContain('จอแตก');
    expect(rejected.product).toBeNull();
    expect(doc.items.filter((item) => item.status === 'PASS').every((item) => item.product?.status === 'IN_STOCK' && item.product.branchId === world.branches.a.id)).toBe(true);
    expect(doc.items.every((item) => item.poItem && item.poItem.brand === BRAND)).toBe(true);
    const list = await api(branchManagerA).get(`/purchase-orders/${ownerPo.id}/goods-receivings`);
    expectStatus(list, 200, 'list receivings');
    routes.push('GET /purchase-orders/:id/goods-receivings');
    const listed = data(list);
    const rows = Array.isArray(listed) ? listed : listed?.data ?? listed?.receivings ?? [];
    expect(rows.map((row: { grNumber: string }) => row.grNumber).sort()).toEqual([firstReceiving.grNumber, secondReceiving.grNumber].sort());

    // Receiving is JE-free (stock enters at cost, AP is the PO itself) and moves no stock documents.
    expect(await journalTouching([ownerPo.id, ownerPo.poNumber, firstReceiving.grNumber, secondReceiving.grNumber, firstReceiving.receivingId])).toBe(0);
    expect(await h.prisma.stockAdjustment.count({ where: { productId: { in: products.map((product) => product.id) } } })).toBe(0);
    expect(h.external.calls).toHaveLength(0);

    saveArtifact(DOMAIN, 'goods-receiving-first.json', JSON.stringify({ result: firstReceiving, document: doc }, null, 2));
    saveArtifact(DOMAIN, 'purchase-order-final.json', JSON.stringify(po, null, 2));
    recordScenario(DOMAIN, scenario({
      id: `${DOMAIN}/po-and-goods-receiving`, title: 'OWNER PO → ORDERED; BM PO → DRAFT → OWNER approve; receiving PASS/REJECT partial then full; ceiling / duplicate IMEI / empty batch / DRAFT and FULLY_RECEIVED refusals; products at PO cost in the main warehouse; no journal entry',
      routes: [...new Set(routes)], renderer: 'none', artifacts: ['goods-receiving-first.json', 'purchase-order-final.json'],
      notes: `PO ${ownerPo.poNumber} · GR ${firstReceiving.grNumber} (5 PASS / 1 REJECT) + ${secondReceiving.grNumber} (2 PASS) · 7 products IN_STOCK at branch ${world.branches.a.name} · BM PO ${bmPo.poNumber} DRAFT→ORDERED by OWNER · GR/PO numbers are count-based per month (not asserted as a sequence)`,
      unverified: ['direct-receive (auto-PO) path', 'QC center / PHOTO_PENDING for PHONE_USED lines', 'PO payment / accounts payable views'],
    }));
  });

  it('authorization: SALES / FINANCE_MANAGER / ACCOUNTANT cannot create or receive, FM / ACCOUNTANT can read a receiving (also via ?company=finance), SALES cannot; unknown ids 404; no / expired token 401', async () => {
    const routes = ['POST /purchase-orders', 'POST /purchase-orders/:id/goods-receiving', 'GET /purchase-orders/:id/goods-receivings/:receivingId'];
    const body = { supplierId: supplier.id, orderDate: ORDER_DATE, items: [poItemBody({ brand: BRAND, model: 'X', category: 'PHONE_NEW', quantity: 1, unitPrice: 1 })] };
    for (const [label, session] of [['SALES', salesA], ['FINANCE_MANAGER', financeManager], ['ACCOUNTANT', accountant]] as const) {
      expectStatus(await api(session).post('/purchase-orders', body), 403, `${label} create PO`);
      expectStatus(await receive(session, ownerPo.id, [{ poItemId: ownerPo.items[0].id, imeiSerial: nextImei(), status: 'PASS' }]), 403, `${label} receive`);
    }
    expectStatus(await readReceiving(salesA, ownerPo.id, firstReceiving.receivingId), 403, 'SALES read receiving');
    const asFm = await readReceiving(financeManager, ownerPo.id, firstReceiving.receivingId, 'FINANCE');
    expectStatus(asFm, 200, 'FM read receiving via finance');
    const asAcc = await readReceiving(accountant, ownerPo.id, firstReceiving.receivingId);
    expectStatus(asAcc, 200, 'ACCOUNTANT read receiving');
    expect(data(asFm).grNumber).toBe(firstReceiving.grNumber);
    expect(data(asAcc).items.length).toBe(data(asFm).items.length);
    // Wrong ids.
    const ghost = '00000000-0000-4000-8000-000000000000';
    expectStatus(await readReceiving(owner, ownerPo.id, ghost), 404, 'unknown receiving');
    expectStatus(await readReceiving(owner, ghost, firstReceiving.receivingId), 404, 'receiving under the wrong PO');
    expectStatus(await receive(owner, ghost, [{ poItemId: ownerPo.items[0].id, imeiSerial: nextImei(), status: 'PASS' }]), 404, 'receive unknown PO');
    expectStatus(await api(owner).get(`/purchase-orders/${ghost}`), 404, 'unknown PO');
    // Tokens.
    expectStatus(await readReceiving(null as unknown as Session, ownerPo.id, firstReceiving.receivingId), 401, 'no token');
    const expired = h.client({ token: mintExpiredAdminToken(h.app, world.users.owner) });
    expectStatus(await expired.get(`/purchase-orders/${ownerPo.id}/goods-receivings/${firstReceiving.receivingId}`), 401, 'expired token');
    expectStatus(await expired.post(`/purchase-orders/${ownerPo.id}/goods-receiving`, { items: [{ poItemId: ownerPo.items[0].id, imeiSerial: nextImei(), status: 'PASS' }] }), 401, 'expired token receive');
    // Nothing leaked into the PO.
    expect(await h.prisma.goodsReceiving.count({ where: { poId: ownerPo.id } })).toBe(2);
    expect(await h.prisma.product.count({ where: { poId: ownerPo.id, deletedAt: null } })).toBe(7);

    recordScenario(DOMAIN, scenario({
      id: `${DOMAIN}/authorization`, title: 'RolesGuard on create/approve/receive/read, identical read for FINANCE_MANAGER via ?company=finance, 404 on unknown PO / receiving / mismatched pair, 401 without or with an expired token',
      routes, renderer: 'none', artifacts: [],
      notes: 'BranchGuard is not exercised by these routes (no branchId in params/body) — a BRANCH_MANAGER may receive any PO; recorded for the owner as current policy',
    }));
  });

  it('trade-in: quick-buy BUYBACK (CASH, TRANSFER) posts the ShopTradeIn journal and a PHOTO_PENDING used phone; band / evidence / cash-account refusals; requestId replay; voucher.pdf ORIGINAL then COPY with the Thai filename; EXCHANGE trade-in → trade-in credit journal and ใบรับเครื่องเทิร์น', async () => {
    const routes: string[] = ['POST /trade-ins/quick-buy'];
    const artifacts: string[] = [];
    const seller = sellerEvidence(world, 'A');
    const base = (extra: Record<string, unknown>) => ({
      requestId: randomUUID(), branchId: world.branches.a.id, ...seller,
      deviceBrand: BRAND, deviceModel: 'ทดสอบระบบ รุ่นรับซื้อ', deviceStorage: '64GB', deviceColor: 'Black', deviceCondition: 'B',
      imei: nextImei(), serialNumber: `TEST-TI-${world.prefix}-${Math.random().toString(36).slice(2, 6)}`,
      agreedPrice: 4500, declarationVersion: TRADE_IN_DECLARATION_VERSION, idCardVerified: true, sellerConsentSigned: true,
      sellerSignatureBase64: SIGNATURE_PNG, paymentMethod: 'CASH', notes: `ข้อมูลทดสอบระบบ — ลบได้ ${world.prefix}`, ...extra,
    });

    // CASH quick-buy by SALES at branch A.
    const cashBody = base({});
    const cash = await api(salesA).post('/trade-ins/quick-buy', cashBody);
    expectStatus(cash, 201, 'quick-buy CASH');
    const cashResult = data(cash);
    expect(cashResult.voucherNumber).toMatch(VOUCHER_NUMBER);
    expect(cashResult.productStatus).toBe('PHOTO_PENDING');
    const cashRow = await h.prisma.tradeIn.findUniqueOrThrow({ where: { id: cashResult.id }, include: { product: true } });
    expect(cashRow.flow).toBe('BUYBACK');
    expect(cashRow.status).toBe('ACCEPTED');
    expect(cashRow.paymentMethod).toBe('CASH');
    expect(cashRow.branchId).toBe(world.branches.a.id);
    expect(Number(cashRow.agreedPrice)).toBe(4500);
    expect(cashRow.voucherNumber).toBe(cashResult.voucherNumber);
    expect(cashRow.voucherPrintedAt).toBeNull();
    expect(cashRow.idCardVerifiedById).toBe(world.users.salesA.id);
    expect((cashRow.sellerDeclarationSnapshot as { version: string; text: string }).version).toBe(TRADE_IN_DECLARATION_VERSION);
    expect((cashRow.sellerDeclarationSnapshot as { version: string; text: string }).text).toBe(TRADE_IN_DECLARATION_TEXT);
    expect(cashRow.product?.category).toBe('PHONE_USED');
    expect(cashRow.product?.status).toBe('PHOTO_PENDING');
    expect(Number(cashRow.product?.costPrice)).toBe(4500);
    expect(cashRow.product?.imeiSerial).toBe(cashBody.imei);
    expect(cashRow.product?.branchId).toBe(world.branches.a.id);
    const cashJournal = await journalFor(cashRow.id);
    expect(cashJournal).toHaveLength(1);
    expect(cashJournal[0].companyId).toBe(shopCompany.id);
    expect(cashJournal[0].status).toBe('POSTED');
    expect((cashJournal[0].metadata as { flow: string }).flow).toBe('shop-trade-in');
    expect(asLines(cashJournal[0])).toEqual(sorted(expectedBuybackJournal(4500, 'CASH')));

    // Replaying the same requestId with the same payload returns the same trade-in — no second product, no second journal.
    const replay = await api(salesA).post('/trade-ins/quick-buy', cashBody);
    expect([200, 201]).toContain(replay.status);
    expect(data(replay).id).toBe(cashResult.id);
    expect(data(replay).voucherNumber).toBe(cashResult.voucherNumber);
    expect(await h.prisma.product.count({ where: { imeiSerial: cashBody.imei, deletedAt: null } })).toBe(1);
    expect(await journalFor(cashRow.id)).toHaveLength(1);
    // Same requestId, different payload → conflict.
    const tampered = await api(salesA).post('/trade-ins/quick-buy', { ...cashBody, agreedPrice: 4600 });
    expectStatus(tampered, 409, 'requestId reused with another payload');

    // Valuation band: the table row (ทดสอบระบบ iPhone 15 128GB A = 10,000) refuses 5,000 and accepts 9,000 via TRANSFER → SHOP paying bank.
    const band = valuationBand(VALUATION.basePrice);
    const belowBand = await api(salesA).post('/trade-ins/quick-buy', base({ deviceModel: VALUATION.model, deviceStorage: VALUATION.storage, deviceCondition: VALUATION.condition, agreedPrice: band.floor - 3500 }));
    expectStatus(belowBand, 400, 'quick-buy below the ±15% band');
    expect(message(belowBand)).toContain('±15%');
    const transferBody = base({ deviceModel: VALUATION.model, deviceStorage: VALUATION.storage, deviceCondition: VALUATION.condition, agreedPrice: 9000, paymentMethod: 'TRANSFER', transferBankName: 'ทดสอบระบบ ธนาคาร', transferAccountNumber: '1234567890', transferAccountName: seller.sellerName });
    const transfer = await api(branchManagerA).post('/trade-ins/quick-buy', transferBody);
    expectStatus(transfer, 201, 'quick-buy TRANSFER inside the band');
    const transferRow = await h.prisma.tradeIn.findUniqueOrThrow({ where: { id: data(transfer).id }, include: { product: true } });
    expect(transferRow.paymentMethod).toBe('TRANSFER');
    expect(transferRow.transferAccountName).toBe(seller.sellerName);
    expect(Number(transferRow.product?.costPrice)).toBe(9000);
    expect(transferRow.product?.name).toContain(BRAND);
    const transferJournal = await journalFor(transferRow.id);
    expect(transferJournal).toHaveLength(1);
    expect(asLines(transferJournal[0])).toEqual(sorted(expectedBuybackJournal(9000, 'TRANSFER')));
    // TRANSFER without bank details is refused before anything is written.
    const noBank = await api(branchManagerA).post('/trade-ins/quick-buy', base({ paymentMethod: 'TRANSFER' }));
    expectStatus(noBank, 400, 'TRANSFER without bank details');

    // Evidence rules and the fail-closed branch cash account.
    const noDevice = await api(salesA).post('/trade-ins/quick-buy', base({ imei: undefined, serialNumber: undefined }));
    expectStatus(noDevice, 400, 'no IMEI / serial');
    expect(message(noDevice)).toContain('IMEI');
    const badId = await api(salesA).post('/trade-ins/quick-buy', base({ sellerIdCardNumber: '1234567890123' }));
    expectStatus(badId, 400, 'national id checksum');
    expect(message(badId)).toContain('บัตรประชาชน');
    const badImei = await api(salesA).post('/trade-ins/quick-buy', base({ imei: '12345' }));
    expectStatus(badImei, 400, 'IMEI must be 15 digits');
    const wrongDeclaration = await api(salesA).post('/trade-ins/quick-buy', base({ declarationVersion: '1900-01-01.0' }));
    expectStatus(wrongDeclaration, 400, 'declaration version');
    const noSignature = await api(salesA).post('/trade-ins/quick-buy', base({ sellerSignatureBase64: undefined }));
    expectStatus(noSignature, 400, 'missing seller signature');
    const branchBBody = base({ branchId: world.branches.b.id });
    const branchB = await api(owner).post('/trade-ins/quick-buy', branchBBody);
    expectStatus(branchB, 400, 'branch without SHOP cash account');
    expect(await h.prisma.tradeIn.count({ where: { quickBuyRequestId: branchBBody.requestId } })).toBe(0);
    const crossBranch = await api(salesB).post('/trade-ins/quick-buy', base({}));
    expectStatus(crossBranch, 403, 'SALES of branch B buying at branch A');
    for (const [label, session] of [['FINANCE_MANAGER', financeManager], ['ACCOUNTANT', accountant]] as const) {
      expectStatus(await api(session).post('/trade-ins/quick-buy', base({})), 403, `${label} quick-buy`);
    }

    // Voucher: first render is the original, every later render a copy; the number stays; nothing else is written.
    routes.push('GET /trade-ins/:id/voucher.pdf', 'POST /trade-ins/:id/voucher');
    const first = await api(salesA).get(`/trade-ins/${cashRow.id}/voucher.pdf`);
    expectStatus(first, 200, 'voucher.pdf first');
    expect(first.headers['content-type']).toContain('application/pdf');
    expect(dispositionFilename(first.headers['content-disposition'])).toBe(`ใบสำคัญจ่ายเงิน_${cashRow.voucherNumber}.pdf`);
    const firstPdf = await parsePdf(bodyBuffer(first));
    artifacts.push(saveArtifact(DOMAIN, `voucher-${cashRow.voucherNumber}-original.pdf`, bodyBuffer(first)).relativePath);
    expect(firstPdf.pageCount).toBe(1);
    expect(firstPdf.pages.every(isA4)).toBe(true);
    expect(pageContaining(firstPdf, 'ผู้รับซื้อ / ผู้ออกเอกสาร')).toBe(pageContaining(firstPdf, 'คำรับรองผู้ขาย'));
    expect(fontsAreSarabun(firstPdf)).toEqual([]);
    insideBounds(firstPdf);
    const firstText = textOf(firstPdf);
    for (const needle of ['ใบสำคัญจ่ายเงิน', 'PAYMENT VOUCHER', 'ต้นฉบับ / ORIGINAL', cashRow.voucherNumber!, seller.sellerName, seller.sellerIdCardNumber, 'เงินสด', 'ผู้รับเงินสด', 'ผู้รับซื้อ / ผู้ออกเอกสาร', 'ผู้รับเงิน (ผู้ขาย)', 'คำรับรองผู้ขาย', thaiBahtText(4500), shopCompany.nameTh, 'ยอดจ่ายสุทธิ']) {
      expect(firstText).toContain(foldThai(needle));
    }
    expect(firstText).toContain(foldThai(TRADE_IN_DECLARATION_TEXT.slice(0, 12)));
    expect(firstText).not.toContain(foldThai('สำเนา / COPY'));
    const afterFirst = await h.prisma.tradeIn.findUniqueOrThrow({ where: { id: cashRow.id } });
    expect(afterFirst.voucherPrintedAt).not.toBeNull();
    const second = await api(owner).get(`/trade-ins/${cashRow.id}/voucher.pdf`);
    expectStatus(second, 200, 'voucher.pdf second');
    const secondPdf = await parsePdf(bodyBuffer(second));
    artifacts.push(saveArtifact(DOMAIN, `voucher-${cashRow.voucherNumber}-copy.pdf`, bodyBuffer(second)).relativePath);
    expect(textOf(secondPdf)).toContain(foldThai('สำเนา / COPY'));
    expect(textOf(secondPdf)).not.toContain(foldThai('ต้นฉบับ / ORIGINAL'));
    const reallocate = await api(owner).post(`/trade-ins/${cashRow.id}/voucher`, {});
    expectStatus(reallocate, 201, 'voucher allocate again');
    expect(data(reallocate).voucherNumber).toBe(cashRow.voucherNumber);
    const afterReprints = await h.prisma.tradeIn.findUniqueOrThrow({ where: { id: cashRow.id } });
    expect(afterReprints.voucherPrintedAt?.toISOString()).toBe(afterFirst.voucherPrintedAt?.toISOString());
    expect(await journalFor(cashRow.id)).toHaveLength(1);
    expect(await h.prisma.product.count({ where: { imeiSerial: cashBody.imei, deletedAt: null } })).toBe(1);
    // Export switch and the pdf of a trade-in that never reached a voucher.
    await setExportEnabled(h.prisma, false);
    expectStatus(await api(owner).get(`/trade-ins/${cashRow.id}/voucher.pdf`), 403, 'voucher.pdf while export_enabled=false');
    await setExportEnabled(h.prisma, null);
    expectStatus(await api(owner).get('/trade-ins/00000000-0000-4000-8000-000000000000/voucher.pdf'), 404, 'voucher.pdf unknown id');

    // EXCHANGE: create → BM appraise → BM accept with TRADE_IN_CREDIT → credit journal → ใบรับเครื่องเทิร์น.
    routes.push('POST /trade-ins', 'PATCH /trade-ins/:id/appraise', 'POST /trade-ins/:id/accept');
    const exchangeSeller = sellerEvidence(world, 'B');
    const exchangeImei = nextImei();
    const created = await api(salesA).post('/trade-ins', { branchId: world.branches.a.id, ...exchangeSeller, deviceBrand: BRAND, deviceModel: 'ทดสอบระบบ รุ่นเทิร์น', deviceStorage: '256GB', deviceColor: 'Blue', deviceCondition: 'B', imei: exchangeImei, serialNumber: `TEST-EX-${world.prefix}`, estimatedValue: 6000, notes: `ข้อมูลทดสอบระบบ — ลบได้ ${world.prefix}` });
    expectStatus(created, 201, 'create EXCHANGE trade-in');
    const exchangeId: string = data(created).id;
    expect(data(created).flow).toBe('EXCHANGE');
    expect(data(created).status).toBe('PENDING_APPRAISAL');
    expectStatus(await api(salesA).patch(`/trade-ins/${exchangeId}/appraise`, { offeredPrice: 6000, deviceCondition: 'B' }), 403, 'SALES appraise');
    const appraised = await api(branchManagerA).patch(`/trade-ins/${exchangeId}/appraise`, { offeredPrice: 6000, deviceCondition: 'B' });
    expectStatus(appraised, 200, 'BM appraise');
    expect(data(appraised).status).toBe('APPRAISED');
    const acceptBody = { declarationVersion: TRADE_IN_DECLARATION_VERSION, idCardVerified: true, sellerConsentSigned: true, paymentMethod: 'TRADE_IN_CREDIT', sellerSignatureBase64: SIGNATURE_PNG };
    expectStatus(await api(branchManagerA).post(`/trade-ins/${exchangeId}/accept`, { ...acceptBody, sellerSignatureBase64: undefined }), 400, 'accept without signature');
    const accepted = await api(branchManagerA).post(`/trade-ins/${exchangeId}/accept`, acceptBody);
    expectStatus(accepted, 201, 'BM accept EXCHANGE');
    const exchangeRow = await h.prisma.tradeIn.findUniqueOrThrow({ where: { id: exchangeId }, include: { product: true } });
    expect(exchangeRow.status).toBe('ACCEPTED');
    expect(exchangeRow.paymentMethod).toBe('TRADE_IN_CREDIT');
    expect(Number(exchangeRow.creditBaseAmount)).toBe(6000);
    expect(Number(exchangeRow.creditBonusAmount)).toBe(0);
    expect(exchangeRow.creditIssuedAt).not.toBeNull();
    expect(exchangeRow.customerId).not.toBeNull();
    expect(exchangeRow.product?.status).toBe('PHOTO_PENDING');
    expect(Number(exchangeRow.product?.costPrice)).toBe(6000);
    expect(exchangeRow.product?.ownedByCompanyId).toBe(shopCompany.id);
    expect(exchangeRow.product?.imeiSerial).toBe(exchangeImei);
    const creditJournal = await journalFor(exchangeId);
    expect(creditJournal).toHaveLength(1);
    expect(creditJournal[0].id).toBe(exchangeRow.creditIssueJournalId);
    expect((creditJournal[0].metadata as { flow: string }).flow).toBe('shop-trade-in-credit-issued');
    expect(asLines(creditJournal[0])).toEqual(sorted(expectedCreditJournal(6000)));
    expectStatus(await api(branchManagerA).post(`/trade-ins/${exchangeId}/accept`, acceptBody), 400, 'accept twice');
    expectStatus(await api(salesA).post(`/trade-ins/${exchangeId}/voucher`, {}), 403, 'SALES allocate voucher');
    const exchangeVoucher = await api(branchManagerA).post(`/trade-ins/${exchangeId}/voucher`, {});
    expectStatus(exchangeVoucher, 201, 'BM allocate voucher');
    const exchangeNumber: string = data(exchangeVoucher).voucherNumber;
    expect(exchangeNumber).toMatch(VOUCHER_NUMBER);
    expect(exchangeNumber).not.toBe(cashRow.voucherNumber);
    const receipt = await api(branchManagerA).get(`/trade-ins/${exchangeId}/voucher.pdf`);
    expectStatus(receipt, 200, 'trade-in receipt pdf');
    expect(dispositionFilename(receipt.headers['content-disposition'])).toBe(`ใบรับเครื่องเทิร์น_${exchangeNumber}.pdf`);
    const receiptPdf = await parsePdf(bodyBuffer(receipt));
    artifacts.push(saveArtifact(DOMAIN, `trade-in-receipt-${exchangeNumber}.pdf`, bodyBuffer(receipt)).relativePath);
    // The declaration makes the credit receipt longer than one A4: the amount table, the agreed credit and the
    // payment block stay on page 1, the declaration + both signatures + footer paginate as one group, and no
    // page is near-empty (before the DOC-02 fix the shared unbreakable closing block pushed every amount line to page 2).
    expect(receiptPdf.pageCount).toBeLessThanOrEqual(2);
    expect(receiptPdf.pages.every(isA4)).toBe(true);
    expect(fontsAreSarabun(receiptPdf)).toEqual([]);
    insideBounds(receiptPdf);
    expect(pageContaining(receiptPdf, 'รายละเอียดเครื่อง')).toBe(1);
    expect(pageContaining(receiptPdf, 'ยอดเครดิตที่ตกลง')).toBe(1);
    expect(pageContaining(receiptPdf, 'รูปแบบการรับเครื่อง')).toBe(1);
    const attestationPage = pageContaining(receiptPdf, 'คำรับรองผู้ขาย');
    expect(attestationPage).toBeGreaterThan(0);
    expect(pageContaining(receiptPdf, 'ผู้รับซื้อ / ผู้ออกเอกสาร')).toBe(attestationPage);
    expect(pageContaining(receiptPdf, 'ออกโดยระบบ BESTCHOICE')).toBe(attestationPage);
    expect(receiptPdf.pages.map((p) => p.items.filter((item) => item.str.trim()).length).every((count) => count >= 12)).toBe(true);
    const receiptText = textOf(receiptPdf);
    for (const needle of ['ใบรับเครื่องเทิร์น', 'TRADE-IN RECEIPT', 'ต้นฉบับ / ORIGINAL', exchangeNumber, exchangeSeller.sellerName, 'ผู้ส่งมอบเครื่อง', 'เครดิตเทิร์นเครื่อง', 'ยอดเครดิตที่ตกลง', thaiBahtText(6000), 'ผู้รับซื้อ / ผู้ออกเอกสาร']) {
      expect(receiptText).toContain(foldThai(needle));
    }
    expect(receiptText).not.toContain(foldThai('ผู้รับเงินสด'));
    expect(await journalFor(exchangeId)).toHaveLength(1);
    expect(h.external.calls).toHaveLength(0);

    saveArtifact(DOMAIN, 'trade-in-rows.json', JSON.stringify({ cash: cashRow, transfer: transferRow, exchange: exchangeRow, journals: { cash: asLines(cashJournal[0]), transfer: asLines(transferJournal[0]), exchange: asLines(creditJournal[0]) } }, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
    artifacts.push('trade-in-rows.json');
    recordScenario(DOMAIN, scenario({
      id: `${DOMAIN}/trade-in-quick-buy-and-vouchers`, title: 'quick-buy CASH/TRANSFER → ACCEPTED BUYBACK, PHOTO_PENDING used phone at the agreed price, ShopTradeIn journal (Dr S11-2002 / Cr branch cash or SHOP paying bank); band, evidence, bank-detail and cash-account refusals; requestId replay; voucher.pdf ORIGINAL → COPY, Thai filename, export switch; EXCHANGE → credit journal (Dr S11-2002 / Cr S21-2003) and ใบรับเครื่องเทิร์น',
      documents: ['TRADE_IN_VOUCHER'], routes: [...new Set(routes)], artifacts,
      notes: `CASH ${cashRow.voucherNumber} (SALES, 4,500) · TRANSFER ${transferRow.voucherNumber} (BM, 9,000 inside ±15% of 10,000) · EXCHANGE ${exchangeNumber} (base 6,000, bonus 0 — counter trade-in without an online quote) · ${h.external.calls.length} outbound calls`,
      unverified: ['trade-in web pages (covered by tools/check-local-trade-in.mjs inside npm run local:check)', 'device-first quick-buy with questionnaire answers / previewToken (online pricing engine)', 'credit redemption at POS', 'PHOTO_PENDING → IN_STOCK via the 6-angle photo queue'],
    }));
  }, 240000);

  it('browser: BRANCH_MANAGER opens the goods receipt print page — header, PO/supplier/receiver, PASS/ไม่ผ่าน rows with the defect label, totals, signatures; A4 portrait print PDF; a 30-unit receipt paginates with totals and signatures together; unknown receiving → error boundary with the print button disabled; SALES is refused; reopening writes nothing', async () => {
    const routes = ['GET /purchase-orders/:id/goods-receivings/:receivingId (web)', 'GET /companies/public (web)'];
    const artifacts: string[] = [];
    // A long receipt: one PO line of 30 units, all PASS.
    longPo = await createPo(owner, [{ brand: BRAND, model: 'Galaxy S24', color: 'Gray', storage: '256GB', category: 'PHONE_NEW', quantity: 30, unitPrice: 9990 }]);
    const longUnits: ReceivingUnit[] = Array.from({ length: 30 }, () => ({ poItemId: longPo.items[0].id, imeiSerial: nextImei(), status: 'PASS' as const }));
    const long = await receive(branchManagerA, longPo.id, longUnits, `ข้อมูลทดสอบระบบ — ลบได้ รับ 30 เครื่อง ${world.prefix}`);
    expectStatus(long, 201, 'long receiving');
    longReceiving = data(long);
    expect(longReceiving.passed).toBe(30);
    expect(longReceiving.status).toBe('FULLY_RECEIVED');
    const beforeProducts = await h.prisma.product.count({ where: { poId: { in: [ownerPo.id, longPo.id] }, deletedAt: null } });
    const beforeReceivings = await h.prisma.goodsReceiving.count({ where: { poId: { in: [ownerPo.id, longPo.id] } } });
    const beforeJournal = await journalTouching([ownerPo.id, longPo.id, firstReceiving.grNumber, longReceiving.grNumber]);

    const printPath = (poId: string, receivingId: string) => `/purchase-orders/${poId}/goods-receivings/${receivingId}/print`;
    bmSession = await openAs(world.users.branchManagerA, printPath(ownerPo.id, firstReceiving.receivingId));
    const { page, errors } = bmSession;
    await waitForText(page, firstReceiving.grNumber, 'gr-print');
    const printButton = page.getByRole('button', { name: 'พิมพ์ / Save PDF' });
    await printButton.waitFor({ state: 'visible' });
    await waitEnabled(printButton, true, 'print button');
    const bodyText = await page.locator('body').innerText();
    for (const needle of ['ใบรับของ', 'GOODS RECEIPT', 'เลขที่เอกสาร', firstReceiving.grNumber, 'อ้างอิงใบสั่งซื้อ', ownerPo.poNumber, 'ผู้จัดจำหน่าย', supplier.name, 'ผู้รับของ', `${BRAND} iPhone 15 Black 128GB`, `${BRAND} Galaxy A55 Navy 256GB`, 'ชุดชาร์จ', 'ผ่าน', 'ไม่ผ่าน', 'จอภาพ', 'จอแตก', 'ตรวจรับทั้งหมด 6 รายการ', 'ผ่าน 5 · ไม่ผ่าน 1', 'ผู้ตรวจสอบ', shopCompany.nameTh, 'รับรอบแรก']) {
      expect(bodyText).toContain(needle);
    }
    expect(await page.getByText('ไม่ผ่าน', { exact: true }).count()).toBe(1);
    expect(await page.getByText('ผ่าน', { exact: true }).count()).toBe(5);
    expect(await page.title()).toBe(`ใบรับของ ${firstReceiving.grNumber}`);
    artifacts.push(...(await shots(page, 'goods-receipt-page')));
    const short = await printToPdf(page, `goods-receipt-${firstReceiving.grNumber}`);
    artifacts.push(short.artifact, short.printMediaShot);
    expect(short.pdf.pageCount).toBe(1);
    expect(short.pdf.pages.every(isA4)).toBe(true);
    expect(short.fontLoaded).toBe(true);
    expect(fontsAreSarabun(short.pdf)).toEqual([]);
    insideBounds(short.pdf);
    const shortText = textOf(short.pdf);
    for (const needle of ['ใบรับของ', firstReceiving.grNumber, ownerPo.poNumber, supplier.name, 'ตรวจรับทั้งหมด 6 รายการ', 'ผู้รับของ', 'ผู้ตรวจสอบ', 'ไม่ผ่าน', 'จอภาพ']) expect(shortText).toContain(foldThai(needle));
    expect(shortText).not.toContain(foldThai('พิมพ์ / Save PDF'));

    // 30 units → more than one page; totals and both signature boxes on the same (last) page; every page carries text.
    await bmSession.runtime.navigate(page, printPath(longPo.id, longReceiving.receivingId));
    await waitForText(page, longReceiving.grNumber, 'gr-print-long');
    await waitEnabled(printButton, true, 'print button (long)');
    await waitForText(page, 'ตรวจรับทั้งหมด 30 รายการ', 'gr-print-long-total');
    const longPrint = await printToPdf(page, `goods-receipt-${longReceiving.grNumber}`);
    artifacts.push(longPrint.artifact);
    expect(longPrint.pdf.pageCount).toBeGreaterThan(1);
    expect(longPrint.pdf.pages.every(isA4)).toBe(true);
    expect(longPrint.pdf.pages.every((p) => p.items.some((item) => item.str.trim()))).toBe(true);
    expect(fontsAreSarabun(longPrint.pdf)).toEqual([]);
    insideBounds(longPrint.pdf);
    const pageIndexWith = (needle: string) => longPrint.pdf.pages.findIndex((p) => foldThai(p.text).includes(foldThai(needle)));
    const totalsPage = pageIndexWith('ตรวจรับทั้งหมด 30 รายการ');
    expect(totalsPage).toBeGreaterThanOrEqual(0);
    expect(pageIndexWith('ผู้ตรวจสอบ')).toBe(totalsPage);
    const imeiPages = longUnits.map((unit) => longPrint.pdf.pages.findIndex((p) => p.text.includes(unit.imeiSerial!)));
    expect(imeiPages.every((index) => index >= 0)).toBe(true);
    expect(new Set(imeiPages).size).toBeGreaterThan(1);

    // Unknown receiving: error boundary, retry offered, print disabled.
    await bmSession.runtime.navigate(page, printPath(ownerPo.id, '00000000-0000-4000-8000-000000000000'));
    await waitForText(page, 'ไม่สามารถโหลดข้อมูลได้', 'gr-print-unknown');
    await page.getByRole('button', { name: 'ลองใหม่' }).waitFor({ state: 'visible' });
    await waitEnabled(printButton, false, 'print button (unknown receiving)');
    artifacts.push(saveArtifact(DOMAIN, 'goods-receipt-unknown-1440.png', await page.screenshot({ fullPage: true })).relativePath);
    // Back to a real one — data returns, button re-enables.
    await bmSession.runtime.navigate(page, printPath(ownerPo.id, firstReceiving.receivingId));
    await waitForText(page, firstReceiving.grNumber, 'gr-print-again');
    await waitEnabled(printButton, true, 'print button (again)');
    expect(pageErrors(errors)).toEqual([]);

    // SALES has no route to the print page.
    const sales = await openAs(world.users.salesA, printPath(ownerPo.id, firstReceiving.receivingId));
    try {
      await waitForText(sales.page, 'ไม่มีสิทธิ์เข้าถึง', 'gr-print-sales');
      artifacts.push(saveArtifact(DOMAIN, 'goods-receipt-sales-forbidden-1440.png', await sales.page.screenshot({ fullPage: true })).relativePath);
      expect(await sales.page.getByRole('button', { name: 'พิมพ์ / Save PDF' }).count()).toBe(0);
    } finally {
      await sales.context.close();
    }

    // Reading and printing changed nothing.
    expect(await h.prisma.product.count({ where: { poId: { in: [ownerPo.id, longPo.id] }, deletedAt: null } })).toBe(beforeProducts);
    expect(await h.prisma.goodsReceiving.count({ where: { poId: { in: [ownerPo.id, longPo.id] } } })).toBe(beforeReceivings);
    expect(await journalTouching([ownerPo.id, longPo.id, firstReceiving.grNumber, longReceiving.grNumber])).toBe(beforeJournal);
    expect(beforeJournal).toBe(0);
    expect((await readPo(longPo.id)).status).toBe('FULLY_RECEIVED');

    recordScenario(DOMAIN, scenario({
      id: `${DOMAIN}/browser-goods-receipt-print`, title: 'GoodsReceiptPrintPage as BRANCH_MANAGER at 1440/390: header with the SHOP identity, GR/PO/supplier/receiver, 6 rows with ผ่าน/ไม่ผ่าน and the defect label, totals and two signature boxes; print-media A4 portrait PDF (1 page); 30-unit receipt paginates with totals + signatures together; unknown receiving → QueryBoundary with ลองใหม่ and the print button disabled; SALES sees ไม่มีสิทธิ์เข้าถึง',
      routes, artifacts, notes: `${consoleNote(errors)} · short GR ${firstReceiving.grNumber} 1 page · long GR ${longReceiving.grNumber} ${longPrint.pdf.pageCount} pages (totals on page ${totalsPage + 1}) · TH Sarabun PSK loaded: ${short.fontLoaded}`,
      unverified: ['window.print() itself (Chromium print-media page.pdf() used instead)', 'OWNER view (same ProtectedRoute roles as BRANCH_MANAGER)'],
    }));
  }, 300000);
});
