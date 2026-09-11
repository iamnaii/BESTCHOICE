/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserContext, Page } from '@playwright/test';
import { DOCUMENT_STYLE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld, WorldUser } from './support/fixtures';
import { fixed2, thaiShortDate } from './support/expense-fixtures';
import { createLoginPacer } from './support/payroll-fixtures';
import { mintExpiredAdminToken, mirroredJournalLines, sortJournalLines, ExpectedJournalLine } from './support/other-income-fixtures';
import { accumulatedThrough, assetMoney, AssetSpec, depreciationFor, expectedDepreciationJournal, expectedDisposalJournal, expectedPurchaseJournal, registerRowExpectation, registerTotals } from './support/asset-fixtures';
import { recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { contentSignature, foldThai, isA4, isA4Landscape, pageContaining, parsePdf, ParsedPdf, textSizes } from './support/pdf';
import { startWeb, WebRuntime } from './support/web';

/**
 * DOC-06 (issue #1565): fixed assets through the real API on the disposable
 * database (draft → post with the asset-purchase journal, deferred VAT →
 * invoice received, transfer of custody, monthly depreciation run and its
 * reversal, disposal by sale, write-off, reversal of a purchase), the real
 * puppeteer receipt (ใบรับสินทรัพย์), the asset register as of a date with its
 * filters and pagination, and the real admin web app (Vite proxy + Playwright)
 * for /assets/register (landscape print) and the receipt preview on /assets/:id.
 *
 * Accounting rules are the system's own (capitalised cost excludes VAT, WHT on
 * the installation part only, daily straight-line depreciation) — nothing is
 * redefined here.
 */
const DOMAIN = 'assets';
const GUARDS = [
  'CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard(OWNER/BRANCH_MANAGER/FINANCE_MANAGER/ACCOUNTANT; post & dispose OWNER/FINANCE_MANAGER; depreciation run OWNER/FM, reverse OWNER)', 'BranchGuard (branchId in query/body)', 'ReversePermissionGuard', 'AuditInterceptor',
  'asset validators (DTO Thai messages, paymentAccount required at post, WHT only on installation)', 'period lock at purchaseDate / disposalDate / period start (period_grace_days)', 'purchase reverse refused while depreciation entries exist',
];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded by the harness, never sent',
  'suppliers are free-text names with synthetic tax ids; branches are the world branches',
  'receipt.pdf is the server renderer (puppeteer); the register print is a browser document captured with Chromium print-media page.pdf()',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['ASSET_RECEIPT'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

type Asset = { id: string; assetCode: string; docNo: string; name: string; category: string; status: string; branchId: string | null; custodian: string | null; location: string | null; purchaseDate: string; purchaseCost: string; vatAmount: string; vatAccount: string | null; whtAmount: string; residualValue: string; usefulLifeMonths: number; monthlyDepr: string; dailyDepr: string; accumulatedDepr: string; netBookValue: string; supplierName: string | null; supplierTaxId: string | null; paymentAccount: string | null; postedAt: string | null; postedById: string | null; disposalDate: string | null; reversalReason: string | null; invoiceReceivedAt: string | null; invoiceTransferJournalEntryId: string | null };
type RegisterRow = { id: string; assetCode: string; name: string; category: string; branchId: string | null; branch: { id: string; name: string } | null; custodian: string | null; purchaseDate: string; purchaseCost: string; accumulatedDeprAt: string; netBookValueAt: string; status: string };
type Register = { data: RegisterRow[]; total: number; page: number; limit: number; asOfDate: string; summary: { count: number; totalPurchaseCost: string; totalAccumulatedDepr: string; totalNbv: string } };

const BANK = '11-1201';
const CASH = '11-1101';
const AP = '21-1104';
const PURCHASE = '2026-05-01';
const JULY = '2026-07';
const AUGUST = '2026-08';

describe('DOC-06 asset receipts and the asset register — real commands, real journal, real renderer and print entries', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let web: WebRuntime | null = null;
  let owner: Session, accountant: Session, financeManager: Session, branchManagerA: Session, salesA: Session;
  let financeCompany: { id: string; nameTh: string; taxId: string };
  const pace = createLoginPacer();
  const assets: Record<string, Asset> = {};
  let accountantSession: { context: BrowserContext; page: Page; errors: string[]; runtime: WebRuntime } | null = null;
  const LONG_SUPPLIER = 'บริษัท ผู้จำหน่ายยานพาหนะและอุปกรณ์ขนส่ง ชื่อยาวมากสำหรับทดสอบการตัดบรรทัดของใบรับสินทรัพย์ (สำนักงานใหญ่ ถนนพระราม 9) จำกัด (มหาชน)';

  // Independent money — four posted assets of three categories, one deferred-VAT vehicle, one later reversed, one draft.
  const specs: Record<string, AssetSpec> = {
    a: { category: 'EQUIPMENT', basePrice: 60000, hasVat: true, vatInclusive: false, vatAccount: '11-4101', residualValue: 0, usefulLifeMonths: 60, paymentAccount: AP, purchaseDate: PURCHASE },
    b: { category: 'VEHICLE', basePrice: 321000, hasVat: true, vatInclusive: true, vatAccount: '11-4102', residualValue: 30000, usefulLifeMonths: 60, paymentAccount: BANK, purchaseDate: PURCHASE },
    c: { category: 'FURNITURE', basePrice: 12000, hasVat: false, residualValue: 0, usefulLifeMonths: 36, paymentAccount: CASH, purchaseDate: PURCHASE },
    f: { category: 'FURNITURE', basePrice: 5000, hasVat: false, residualValue: 0, usefulLifeMonths: 12, paymentAccount: CASH, purchaseDate: PURCHASE },
    d: { category: 'EQUIPMENT', basePrice: 8000, hasVat: false, residualValue: 0, usefulLifeMonths: 60, paymentAccount: BANK, purchaseDate: '2026-09-05' },
  };
  const CUSTODIAN_A = 'ทดสอบระบบ ผู้ดูแล ก';
  const CUSTODIAN_A2 = 'ทดสอบระบบ ผู้ดูแล ข (รับโอน)';

  const api = (session: Session | null, company?: 'SHOP' | 'FINANCE' | null) => h.client({ session, company });
  const f2 = (value: unknown) => Number(value).toFixed(2);
  const th = (value: unknown) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const name = (key: string) => `ทดสอบระบบ สินทรัพย์ ${key.toUpperCase()} ${world.prefix}`;
  const body = (key: string, extra: Record<string, unknown> = {}) => {
    const spec = specs[key];
    return {
      name: name(key), description: 'ข้อมูลทดสอบระบบ — ลบได้', category: spec.category, branchId: world.branches.a.id,
      basePrice: spec.basePrice, shippingCost: spec.shippingCost ?? 0, installationCost: spec.installationCost ?? 0, otherCapitalized: spec.otherCapitalized ?? 0,
      hasVat: spec.hasVat ?? false, vatInclusive: spec.vatInclusive ?? false, vatAccount: spec.vatAccount,
      residualValue: spec.residualValue ?? 0, usefulLifeMonths: spec.usefulLifeMonths, purchaseDate: spec.purchaseDate,
      supplierName: `ทดสอบระบบ บริษัทผู้ขายอุปกรณ์ จำกัด ${world.prefix}`, supplierTaxId: '0105500000001', taxInvoiceNo: `TEST-INV-${world.prefix}-${key.toUpperCase()}`,
      paymentAccount: spec.paymentAccount, custodian: CUSTODIAN_A, location: 'สำนักงาน ชั้น 2 (ทดสอบระบบ)', serialNo: `SN-${world.prefix}-${key.toUpperCase()}`,
      ...extra,
    };
  };
  const create = async (session: Session, key: string, extra: Record<string, unknown> = {}): Promise<Asset> => (await api(session).post('/assets', body(key, extra)).expect(201)).body.data;
  const getAsset = async (session: Session, id: string): Promise<Asset> => (await api(session).get(`/assets/${id}`).expect(200)).body.data;
  const post = (session: Session, id: string) => api(session).post(`/assets/${id}/post`);
  const receipt = async (session: Session, id: string) => {
    const res = await api(session).get(`/assets/${id}/receipt.pdf`).expect(200);
    expect(String(res.headers['content-type'])).toContain('application/pdf');
    const bytes = bodyBuffer(res);
    return { bytes, pdf: await parsePdf(bytes) };
  };
  const journalLines = async (journalEntryId: string): Promise<ExpectedJournalLine[]> => sortJournalLines((await h.prisma.journalLine.findMany({ where: { journalEntryId, deletedAt: null } })).map((row) => ({ accountCode: row.accountCode, debit: fixed2(row.debit), credit: fixed2(row.credit) })));
  // Templates hand `reference` to JournalAutoService, which stores it as referenceId (referenceType 'AUTO').
  const journalByReference = async (reference: string) => h.prisma.journalEntry.findFirstOrThrow({ where: { referenceId: reference, deletedAt: null } });
  const journalsForAsset = async (assetId: string) => h.prisma.journalEntry.findMany({ where: { deletedAt: null, metadata: { path: ['assetId'], equals: assetId } as never } });
  const register = async (session: Session, query: string, company?: 'SHOP' | 'FINANCE' | null): Promise<Register> => (await api(session, company).get(`/assets/register?${query}`).expect(200)).body.data;
  const mineQuery = (query: string) => `${query}&search=${encodeURIComponent(world.prefix)}`;
  const pdfSummary = (pdf: ParsedPdf) => ({ pageCount: pdf.pageCount, pages: pdf.pages.map((page) => ({ index: page.index, widthPt: +page.widthPt.toFixed(2), heightPt: +page.heightPt.toFixed(2), lines: page.lines.length, textItems: page.items.filter((item) => item.str.trim()).length })), fonts: pdf.fonts, sizes: textSizes(pdf) });
  const streamText = (pdf: ParsedPdf) => foldThai(pdf.pages.map((page) => page.items.map((item) => item.str).join('')).join('\n'));
  const expectFonts = (pdf: ParsedPdf) => expect(pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
  const expectInsidePageBox = (pdf: ParsedPdf) => {
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
  const pageErrors = (errors: string[]) => errors.filter((error) => error.startsWith('pageerror'));
  const consoleNote = (errors: string[]) => (errors.length ? `console errors: ${errors.join(' | ').slice(0, 500)}` : 'no console errors');
  const previewBytes = async (page: Page): Promise<Buffer> => {
    const base64 = await page.evaluate(async () => {
      const frame = document.querySelector('[role="dialog"] iframe') as HTMLIFrameElement | null;
      if (!frame) throw new Error('no preview iframe');
      const bytes = new Uint8Array(await (await fetch((frame.getAttribute('src') ?? '').split('#')[0])).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      return btoa(binary);
    });
    return Buffer.from(base64, 'base64');
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    financeCompany = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true, nameTh: true, taxId: true } });
    for (const [key, user] of [['owner', world.users.owner], ['accountant', world.users.accountant], ['financeManager', world.users.financeManager], ['branchManagerA', world.users.branchManagerA], ['salesA', world.users.salesA]] as const) {
      await pace();
      const session = await h.login(user.email, user.password);
      if (key === 'owner') owner = session; else if (key === 'accountant') accountant = session; else if (key === 'financeManager') financeManager = session; else if (key === 'branchManagerA') branchManagerA = session; else salesA = session;
    }
  }, 240000);

  afterAll(async () => {
    if (accountantSession) await accountantSession.context.close().catch(() => undefined);
    if (web) await web.close();
    await h.close();
  });

  it('authorization — SALES 403 everywhere, BRANCH_MANAGER is fenced to its branch by BranchGuard, ACCOUNTANT cannot post / dispose / run depreciation, missing or expired token 401, unknown id 404, receipt of a DRAFT 400', async () => {
    assets.e = await create(accountant, 'a', { name: `${name('e')} ร่าง`, basePrice: 1000, serialNo: `SN-${world.prefix}-E` });
    expect(assets.e.status).toBe('DRAFT');
    expect(assets.e.docNo).toMatch(/^ASSET-\d{4}-\d{4}$/);
    expect(assets.e.assetCode).toMatch(/^EQ-\d+$/);
    for (const path of ['/assets', `/assets/register?asOfDate=2026-08-31`, `/assets/${assets.e.id}`, `/assets/${assets.e.id}/receipt.pdf`, '/depreciation', `/depreciation/preview/${JULY}`]) await api(salesA).get(path).expect(403);
    await api(salesA).post('/assets', body('a')).expect(403);
    await api(null).get('/assets').expect(401);
    await api(null).get(`/assets/${assets.e.id}/receipt.pdf`).expect(401);
    const expired = mintExpiredAdminToken(h.app, { id: world.users.accountant.id, email: world.users.accountant.email, role: 'ACCOUNTANT', branchId: null });
    await h.client({ token: expired, company: 'FINANCE' }).get('/assets').expect(401);
    await api(accountant).get('/assets/00000000-0000-4000-8000-000000000000').expect(404);
    await api(accountant).get('/assets/00000000-0000-4000-8000-000000000000/receipt.pdf').expect(404);
    // A draft has no receipt yet.
    expect((await api(accountant).get(`/assets/${assets.e.id}/receipt.pdf`)).status).toBe(400);
    // Branch manager: own branch passes, another branch is refused by BranchGuard (query and body alike).
    await api(branchManagerA).get(`/assets?branchId=${world.branches.a.id}`).expect(200);
    await api(branchManagerA).get(`/assets?branchId=${world.branches.b.id}`).expect(403);
    await api(branchManagerA).get(`/assets/register?asOfDate=2026-08-31&branchId=${world.branches.b.id}`).expect(403);
    await api(branchManagerA).post('/assets', body('c', { branchId: world.branches.b.id })).expect(403);
    // Posting, disposing and running depreciation are OWNER / FINANCE_MANAGER work.
    await post(accountant, assets.e.id).expect(403);
    await post(branchManagerA, assets.e.id).expect(403);
    await api(accountant).post(`/assets/${assets.e.id}/dispose`, { disposalType: 'WRITE_OFF', disposalDate: '2026-08-01', reason: 'ทดสอบระบบ ไม่มีสิทธิ์' }).expect(403);
    await api(accountant).post('/depreciation/run', { period: JULY }).expect(403);
    await api(financeManager).post(`/depreciation/${JULY}/reverse`, { period: JULY, reason: 'ทดสอบระบบ FM ไม่ใช่ OWNER' }).expect(403);
    expect((await getAsset(accountant, assets.e.id)).status).toBe('DRAFT');
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/authorization`, title: 'SALES refused on list/register/detail/receipt/depreciation (403); missing or expired JWT → 401; unknown id → 404; DRAFT receipt → 400; BRANCH_MANAGER passes for its own branch and is refused for another branch in query or body (BranchGuard); ACCOUNTANT and BRANCH_MANAGER cannot post/dispose/run depreciation, FINANCE_MANAGER cannot reverse a depreciation run (OWNER only)', routes: ['GET /api/assets', 'GET /api/assets/register', 'GET /api/assets/:id', 'GET /api/assets/:id/receipt.pdf', 'POST /api/assets', 'POST /api/assets/:id/post', 'POST /api/assets/:id/dispose', 'POST /api/depreciation/run', 'POST /api/depreciation/:period/reverse'], renderer: 'none', artifacts: [] }));
  }, 120000);

  it('draft → post: asset code, document number, supplier, branch, custodian and values persist as entered; the purchase journal matches the independent fixture per category (VAT 11-4101 / deferred 11-4102 / no VAT); deferred VAT moves to 11-4101 when the invoice arrives; custody transfers; receipt.pdf is one A4 page of the receipt family', async () => {
    for (const key of ['a', 'b', 'c', 'f'] as const) {
      const extra: Record<string, unknown> = key === 'b' ? { supplierName: `ทดสอบระบบ ${LONG_SUPPLIER} ${world.prefix}`, supplierTaxId: '0105500000002', custodian: 'ทดสอบระบบ ผู้ดูแลยานพาหนะ', location: 'ลานจอดรถ สำนักงานใหญ่' } : key === 'c' || key === 'f' ? { branchId: world.branches.b.id, custodian: 'ทดสอบระบบ ผู้ดูแลสาขา B' } : {};
      const created = await create(accountant, key, extra);
      const money = assetMoney(specs[key]);
      expect(created.status).toBe('DRAFT');
      expect(created.docNo).toMatch(/^ASSET-\d{4}-\d{4}$/);
      expect(f2(created.purchaseCost)).toBe(money.purchaseCost.toFixed(2));
      expect(f2(created.vatAmount)).toBe(money.vat.toFixed(2));
      expect(f2(created.whtAmount)).toBe(money.wht.toFixed(2));
      expect(Number(created.dailyDepr).toFixed(4)).toBe(money.dailyDepr.toFixed(4));
      expect(f2(created.netBookValue)).toBe(money.purchaseCost.toFixed(2));
      expect(created.purchaseDate.slice(0, 10)).toBe(specs[key].purchaseDate);
      // Only OWNER / FINANCE_MANAGER post; the journal lands on the FINANCE company dated at the purchase.
      const posted = await post(key === 'b' ? owner : financeManager, created.id);
      expect([200, 201]).toContain(posted.status);
      assets[key] = await getAsset(accountant, created.id);
      expect(assets[key].status).toBe('POSTED');
      expect(assets[key].postedAt).toBeTruthy();
      const je = await journalByReference(`${created.id}:asset-purchase`);
      expect(je.status).toBe('POSTED');
      expect(je.companyId).toBe(financeCompany.id);
      expect(await journalLines(je.id)).toEqual(expectedPurchaseJournal(specs[key]));
      expect([400, 409]).toContain((await post(financeManager, created.id)).status);
      expect((await journalsForAsset(created.id)).length).toBe(1);
    }
    // A posted asset can no longer be edited or deleted; the draft can.
    expect((await api(accountant).patch(`/assets/${assets.a.id}`, { custodian: 'แก้หลังโพสต์' })).status).toBe(400);
    expect((await api(accountant).delete(`/assets/${assets.a.id}`)).status).toBe(400);
    expect((await api(accountant).patch(`/assets/${assets.e.id}`, { location: 'ห้องเก็บของ (ทดสอบระบบ)' })).status).toBe(200);
    // Draft posted without a payment account is refused by the template.
    const noPayment = await create(accountant, 'c', { name: `${name('x')} ไม่มีบัญชีจ่าย`, paymentAccount: undefined, serialNo: `SN-${world.prefix}-X` });
    const noPaymentPost = await post(financeManager, noPayment.id);
    expect(noPaymentPost.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(noPaymentPost.body)).toContain('paymentAccount');
    await api(accountant).delete(`/assets/${noPayment.id}`).expect(204);

    // Deferred VAT on the vehicle: the invoice arrives → Dr 11-4101 / Cr 11-4102 and the asset now carries 11-4101.
    expect((await api(accountant).post(`/assets/${assets.a.id}/invoice-received`)).status).toBe(400);
    const invoice = await api(accountant).post(`/assets/${assets.b.id}/invoice-received`);
    expect([200, 201]).toContain(invoice.status);
    assets.b = await getAsset(accountant, assets.b.id);
    expect(assets.b.vatAccount).toBe('11-4101');
    expect(assets.b.invoiceReceivedAt).toBeTruthy();
    expect(await journalLines(assets.b.invoiceTransferJournalEntryId!)).toEqual(sortJournalLines([{ accountCode: '11-4101', debit: assetMoney(specs.b).vat.toFixed(2), credit: '0.00' }, { accountCode: '11-4102', debit: '0.00', credit: assetMoney(specs.b).vat.toFixed(2) }]));
    expect((await api(accountant).post(`/assets/${assets.b.id}/invoice-received`)).status).toBe(400);

    // Custody transfer is an operational change — no journal.
    const beforeTransfer = (await journalsForAsset(assets.a.id)).length;
    expect((await api(accountant).post(`/assets/${assets.a.id}/transfer`, { transferDate: '2026-08-10', toCustodian: CUSTODIAN_A2, reason: 'ย้ายผู้ดูแลตามโครงสร้างใหม่ (ทดสอบระบบ)' })).status).toBeLessThan(300);
    assets.a = await getAsset(accountant, assets.a.id);
    expect(assets.a.custodian).toBe(CUSTODIAN_A2);
    expect((await journalsForAsset(assets.a.id)).length).toBe(beforeTransfer);

    // Receipt of the equipment: one A4 page in the receipt family with every persisted figure.
    const receiptA = await receipt(accountant, assets.a.id);
    expect(receiptA.pdf.pageCount).toBe(1);
    expect(receiptA.pdf.pages.every(isA4)).toBe(true);
    expectFonts(receiptA.pdf);
    expect(textSizes(receiptA.pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
    expectInsidePageBox(receiptA.pdf);
    const moneyA = assetMoney(specs.a);
    const textA = streamText(receiptA.pdf);
    for (const token of ['ใบรับสินทรัพย์', 'ASSET GOODS RECEIPT', assets.a.docNo, assets.a.assetCode, thaiShortDate(PURCHASE), `TEST-INV-${world.prefix}-A`, financeCompany.nameTh, financeCompany.taxId, `ทดสอบระบบ บริษัทผู้ขายอุปกรณ์ จำกัด ${world.prefix}`, '0105500000001', world.branches.a.name, name('a'), 'อายุการใช้งาน 60 เดือน', 'ราคาทุน (มูลค่าซื้อ)', th(moneyA.basePrice), 'มูลค่าต้นทุนที่บันทึกเป็นสินทรัพย์', th(moneyA.purchaseCost), 'ภาษีมูลค่าเพิ่ม 7% (อ้างอิง)', th(moneyA.vat), 'มูลค่าต้นทุนรวม', 'บาทถ้วน', 'ผู้จัดทำ', 'ผู้ตรวจรับ / ผู้อนุมัติ', 'ผู้ส่งมอบ']) expect(textA).toContain(foldThai(token));
    expect(textA).not.toContain(foldThai('กลับรายการแล้ว'));
    expect(pageContaining(receiptA.pdf, 'มูลค่าต้นทุนรวม')).toBe(pageContaining(receiptA.pdf, 'ผู้ส่งมอบ'));
    // Re-reading books nothing and renders the same content.
    const again = await receipt(accountant, assets.a.id);
    expect(contentSignature(again.pdf)).toBe(contentSignature(receiptA.pdf));
    expect((await journalsForAsset(assets.a.id)).length).toBe(beforeTransfer);
    for (const session of [owner, financeManager, branchManagerA]) expect(contentSignature((await receipt(session, assets.a.id)).pdf)).toBe(contentSignature(receiptA.pdf));
    // Long supplier name (vehicle) stays inside the page box on one page; no-VAT furniture prints no VAT line.
    const receiptB = await receipt(accountant, assets.b.id);
    expect(receiptB.pdf.pageCount).toBe(1);
    expectInsidePageBox(receiptB.pdf);
    for (const token of [LONG_SUPPLIER.slice(0, 40), '0105500000002', th(assetMoney(specs.b).purchaseCost), th(assetMoney(specs.b).vat)]) expect(streamText(receiptB.pdf)).toContain(foldThai(token));
    const receiptC = await receipt(accountant, assets.c.id);
    expect(streamText(receiptC.pdf)).toContain(foldThai(world.branches.b.name));
    expect(streamText(receiptC.pdf)).not.toContain(foldThai('ภาษีมูลค่าเพิ่ม 7%'));
    const artifacts = [saveArtifact(DOMAIN, 'asset-receipt-a-equipment.pdf', receiptA.bytes).relativePath, saveArtifact(DOMAIN, 'asset-receipt-b-vehicle-long-supplier.pdf', receiptB.bytes).relativePath, saveArtifact(DOMAIN, 'asset-receipt-c-furniture-no-vat.pdf', receiptC.bytes).relativePath, saveArtifact(DOMAIN, 'asset-receipt-a-equipment.pdf.json', JSON.stringify({ ...pdfSummary(receiptA.pdf), longSupplier: pdfSummary(receiptB.pdf), expected: { purchaseCost: moneyA.purchaseCost.toFixed(2), vat: moneyA.vat.toFixed(2), dailyDepr: moneyA.dailyDepr.toFixed(4) }, assets: Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, { assetCode: asset.assetCode, docNo: asset.docNo, status: asset.status }])) }, null, 2)).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/draft-post-receipt`, title: 'four assets (equipment with VAT 11-4101 on AP, vehicle with VAT included and deferred 11-4102 by bank, two furniture items without VAT by cash, branch B) posted by FINANCE_MANAGER / OWNER: journal per category Dr cost / Dr VAT / Cr payment on the FINANCE company equals the fixture, second post refused, POSTED cannot be edited or deleted, a draft without a payment account cannot be posted; invoice received → Dr 11-4101 / Cr 11-4102 and vatAccount flips; custody transfer books nothing; receipt.pdf one A4 portrait page (TH Sarabun PSK 16 pt) with doc number, asset code, purchase date, tax invoice, supplier, branch, cost rows, VAT reference, total in words, three signature blocks; re-read identical; a 120-character supplier name stays inside the page box; no VAT line when hasVat is off', routes: ['POST /api/assets', 'PATCH /api/assets/:id', 'DELETE /api/assets/:id', 'POST /api/assets/:id/post', 'POST /api/assets/:id/invoice-received', 'POST /api/assets/:id/transfer', 'GET /api/assets/:id', 'GET /api/assets/:id/receipt.pdf'], artifacts }));
  }, 240000);

  it('depreciation, disposal, write-off and reversal: monthly run books the daily straight-line amount per asset, a run is idempotent, disposal by sale and write-off book accumulated depreciation and the gain/loss plug, a purchase with depreciation cannot be reversed while a fresh one can, and a reversed run leaves the register', async () => {
    const preview = (await api(financeManager).get(`/depreciation/preview/${JULY}`).expect(200)).body.data;
    const previewRows: Array<{ assetId?: string; assetCode?: string; amount?: string | number }> = preview.items ?? preview.assets ?? preview.rows ?? preview.data ?? [];
    for (const key of ['a', 'b', 'c', 'f'] as const) {
      const row = previewRows.find((item) => item.assetId === assets[key].id || item.assetCode === assets[key].assetCode);
      if (row?.amount != null) expect(f2(row.amount)).toBe(depreciationFor(specs[key], JULY).toFixed(2));
    }
    // July run — FINANCE_MANAGER; one journal + one entry per posted asset.
    const julyRun = await api(financeManager).post('/depreciation/run', { period: JULY });
    expect([200, 201]).toContain(julyRun.status);
    for (const key of ['a', 'b', 'c', 'f'] as const) {
      const entry = await h.prisma.depreciationEntry.findUniqueOrThrow({ where: { assetId_period: { assetId: assets[key].id, period: JULY } } });
      expect(f2(entry.amount)).toBe(depreciationFor(specs[key], JULY).toFixed(2));
      expect(entry.reversedAt).toBeNull();
      const je = await journalByReference(`${assets[key].id}:depreciation:${JULY}`);
      expect(await journalLines(je.id)).toEqual(expectedDepreciationJournal(specs[key], JULY));
    }
    expect(f2((await getAsset(accountant, assets.a.id)).accumulatedDepr)).toBe(depreciationFor(specs.a, JULY).toFixed(2));
    // Running the same period again books nothing new.
    const julyEntriesBefore = await h.prisma.depreciationEntry.count({ where: { period: JULY, reversedAt: null, assetId: { in: ['a', 'b', 'c', 'f'].map((key) => assets[key].id) } } });
    const julyAgain = await api(owner).post('/depreciation/run', { period: JULY });
    expect([200, 201]).toContain(julyAgain.status);
    expect(await h.prisma.depreciationEntry.count({ where: { period: JULY, reversedAt: null, assetId: { in: ['a', 'b', 'c', 'f'].map((key) => assets[key].id) } } })).toBe(julyEntriesBefore);
    expect(await h.prisma.journalEntry.count({ where: { referenceId: `${assets.a.id}:depreciation:${JULY}`, deletedAt: null } })).toBe(1);
    // A future period is refused.
    expect((await api(owner).post('/depreciation/run', { period: '2027-01' })).status).toBe(400);
    expect((await api(owner).post('/depreciation/run', { period: '2026-7' })).status).toBe(400);

    // Disposal by sale (furniture in branch B) on 20 Aug with July's depreciation booked: Dr accumulated / Dr cash / Cr cost / loss plug.
    const accumulatedC = accumulatedThrough(specs.c, [JULY], JULY);
    expect((await api(accountant).post(`/assets/${assets.c.id}/dispose`, { disposalType: 'SALE', disposalDate: '2026-08-20', proceeds: 9000, depositAccountCode: CASH, reason: 'ขายเฟอร์นิเจอร์เก่า (ทดสอบระบบ)' })).status).toBe(403);
    expect((await api(financeManager).post(`/assets/${assets.c.id}/dispose`, { disposalType: 'SALE', disposalDate: '2099-01-01', proceeds: 9000, depositAccountCode: CASH, reason: 'วันที่อนาคต (ทดสอบระบบ)' })).status).toBe(400);
    const sale = await api(financeManager).post(`/assets/${assets.c.id}/dispose`, { disposalType: 'SALE', disposalDate: '2026-08-20', proceeds: 9000, depositAccountCode: CASH, reason: 'ขายเฟอร์นิเจอร์เก่า (ทดสอบระบบ)' });
    expect([200, 201]).toContain(sale.status);
    assets.c = await getAsset(accountant, assets.c.id);
    expect(assets.c.status).toBe('DISPOSED');
    expect(assets.c.disposalDate?.slice(0, 10)).toBe('2026-08-20');
    expect(f2(assets.c.netBookValue)).toBe('0.00');
    expect(await journalLines((await journalByReference(`${assets.c.id}:disposal`)).id)).toEqual(expectedDisposalJournal(specs.c, accumulatedC, 9000, CASH));
    // Write-off (the other furniture item) on 25 Aug: no proceeds, the whole net book value is a loss.
    const writeOff = await api(owner).post(`/assets/${assets.f.id}/dispose`, { disposalType: 'WRITE_OFF', disposalDate: '2026-08-25', reason: 'ชำรุดใช้งานไม่ได้ (ทดสอบระบบ)' });
    expect([200, 201]).toContain(writeOff.status);
    assets.f = await getAsset(accountant, assets.f.id);
    expect(assets.f.status).toBe('WRITTEN_OFF');
    expect(await journalLines((await journalByReference(`${assets.f.id}:disposal`)).id)).toEqual(expectedDisposalJournal(specs.f, accumulatedThrough(specs.f, [JULY], JULY), 0));
    // Disposed assets leave the depreciation run: August books only the two held assets.
    const augustRun = await api(financeManager).post('/depreciation/run', { period: AUGUST });
    expect([200, 201]).toContain(augustRun.status);
    for (const key of ['a', 'b'] as const) expect(f2((await h.prisma.depreciationEntry.findUniqueOrThrow({ where: { assetId_period: { assetId: assets[key].id, period: AUGUST } } })).amount)).toBe(depreciationFor(specs[key], AUGUST).toFixed(2));
    for (const key of ['c', 'f'] as const) expect(await h.prisma.depreciationEntry.findUnique({ where: { assetId_period: { assetId: assets[key].id, period: AUGUST } } })).toBeNull();
    // Schedule endpoint = the full projection from the purchase month (booked periods override it) — July's booked
    // amount and the projected accumulation through August (May, June projected + July, August booked) match the fixture.
    const schedule = (await api(accountant).get(`/assets/${assets.a.id}/schedule`).expect(200)).body.data;
    const scheduleRows: Array<{ period: string; monthlyDepr: string | number; accumulatedDepr: string | number }> = schedule.rows;
    expect(f2(scheduleRows.find((row) => row.period === JULY)!.monthlyDepr)).toBe(depreciationFor(specs.a, JULY).toFixed(2));
    expect(f2(scheduleRows.find((row) => row.period === AUGUST)!.accumulatedDepr)).toBe(accumulatedThrough(specs.a, ['2026-05', '2026-06', JULY, AUGUST], AUGUST).toFixed(2));

    // A purchase with depreciation booked cannot be reversed; a fresh September purchase can, and its receipt says so.
    const blocked = await api(owner).post(`/assets/${assets.a.id}/reverse`, { reason: 'ทดสอบระบบ กลับรายการทั้งที่มีค่าเสื่อม' });
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(blocked.body)).toContain('depreciation');
    expect((await getAsset(accountant, assets.a.id)).status).toBe('POSTED');
    const created = await create(accountant, 'd', { branchId: world.branches.a.id });
    expect([200, 201]).toContain((await post(financeManager, created.id)).status);
    const reversed = await api(owner).post(`/assets/${created.id}/reverse`, { reason: 'ซื้อซ้ำ ยกเลิกรายการ (ทดสอบระบบ)' });
    expect([200, 201]).toContain(reversed.status);
    assets.d = await getAsset(accountant, created.id);
    expect(assets.d.status).toBe('REVERSED');
    expect(assets.d.reversalReason).toContain('ซื้อซ้ำ');
    const dJournals = await journalsForAsset(created.id);
    const dPurchase = dJournals.find((je) => (je.metadata as any)?.flow === 'asset-purchase')!;
    const dReverse = dJournals.find((je) => (je.metadata as any)?.flow === 'asset-purchase-reverse')!;
    expect(await journalLines(dReverse.id)).toEqual(mirroredJournalLines(await journalLines(dPurchase.id)));
    const receiptD = await receipt(accountant, created.id);
    expect(streamText(receiptD.pdf)).toContain(foldThai('กลับรายการแล้ว'));

    // Reversing the August run (OWNER only): the entries are flagged and the register falls back to July.
    // The DTO carries the period again next to the reason (the route param alone is not enough).
    const augustReverse = await api(owner).post(`/depreciation/${AUGUST}/reverse`, { period: AUGUST, reason: 'รันผิดงวด ทดสอบระบบ' });
    expect([200, 201]).toContain(augustReverse.status);
    for (const key of ['a', 'b'] as const) expect((await h.prisma.depreciationEntry.findUniqueOrThrow({ where: { assetId_period: { assetId: assets[key].id, period: AUGUST } } })).reversedAt).toBeTruthy();
    // A second reversal of August is refused.
    expect((await api(owner).post(`/depreciation/${AUGUST}/reverse`, { period: AUGUST, reason: 'กลับซ้ำ ทดสอบระบบ' })).status).toBeGreaterThanOrEqual(400);
    const artifacts = [saveArtifact(DOMAIN, 'asset-receipt-d-reversed.pdf', receiptD.bytes).relativePath, saveArtifact(DOMAIN, 'depreciation-and-disposal.json', JSON.stringify({ july: Object.fromEntries((['a', 'b', 'c', 'f'] as const).map((key) => [assets[key].assetCode, depreciationFor(specs[key], JULY).toFixed(2)])), august: Object.fromEntries((['a', 'b'] as const).map((key) => [assets[key].assetCode, depreciationFor(specs[key], AUGUST).toFixed(2)])), disposalC: expectedDisposalJournal(specs.c, accumulatedC, 9000, CASH), writeOffF: expectedDisposalJournal(specs.f, accumulatedThrough(specs.f, [JULY], JULY), 0) }, null, 2)).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/depreciation-disposal-reverse`, title: 'July run (FINANCE_MANAGER) books Dr 53-160X / Cr 12-210X per posted asset = daily rate × 31 days (fixture), idempotent on re-run, future or malformed period refused; sale of furniture (accumulated + cash / cost / loss 53-1605) and write-off (WRITTEN_OFF) with the fixture journals, ACCOUNTANT refused, future disposal date refused; August run skips the disposed assets; schedule endpoint agrees; purchase reverse refused while depreciation exists, fresh purchase reversed → mirrored journal + "กลับรายการแล้ว" on the receipt; August run reversed by OWNER (entries flagged), double reversal refused', documents: ['ASSET_RECEIPT', 'DEPRECIATION'], routes: ['GET /api/depreciation/preview/:period', 'POST /api/depreciation/run', 'POST /api/depreciation/:period/reverse', 'POST /api/assets/:id/dispose', 'POST /api/assets/:id/reverse', 'GET /api/assets/:id/schedule', 'GET /api/assets/:id/receipt.pdf'], artifacts }));
  }, 300000);

  it('asset register as of a date: held assets only, disposed ones until their disposal date, drafts and reversed never, per-row cost / accumulated depreciation / NBV and the summary over every page equal the independent fixture; filters by status, category and branch; identical for every allowed role', async () => {
    const periodsRun = [JULY]; // August was reversed
    const expectRow = (row: RegisterRow, key: keyof typeof specs, asOf: string) => {
      const want = registerRowExpectation(specs[key], periodsRun, asOf);
      expect({ purchaseCost: f2(row.purchaseCost), accumulatedDeprAt: f2(row.accumulatedDeprAt), netBookValueAt: f2(row.netBookValueAt) }).toEqual(want);
      expect(row.purchaseDate).toBe(specs[key].purchaseDate);
    };
    // End of August: a and b are held; c (sold 20 Aug) and f (written off 25 Aug) are gone; d (reversed) and e (draft) never appear.
    const endAug = await register(accountant, mineQuery('asOfDate=2026-08-31'));
    expect(endAug.data.map((row) => row.assetCode).sort()).toEqual([assets.a.assetCode, assets.b.assetCode].sort());
    expectRow(endAug.data.find((row) => row.id === assets.a.id)!, 'a', '2026-08-31');
    expectRow(endAug.data.find((row) => row.id === assets.b.id)!, 'b', '2026-08-31');
    expect(endAug.data.find((row) => row.id === assets.a.id)!.custodian).toBe(CUSTODIAN_A2);
    expect(endAug.data.find((row) => row.id === assets.a.id)!.branch?.name).toBe(world.branches.a.name);
    expect(endAug.summary).toEqual(registerTotals([registerRowExpectation(specs.a, periodsRun, '2026-08-31'), registerRowExpectation(specs.b, periodsRun, '2026-08-31')]));
    // Regression (defect fixed in DOC-06): the summary used to add up only the current page — with one row per page every
    // page must still report the register's full count and totals.
    const page1 = await register(accountant, mineQuery('asOfDate=2026-08-31&limit=1&page=1'));
    const page2 = await register(accountant, mineQuery('asOfDate=2026-08-31&limit=1&page=2'));
    expect(page1.data).toHaveLength(1);
    expect(page2.data).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect([page1.data[0].id, page2.data[0].id].sort()).toEqual([assets.a.id, assets.b.id].sort());
    expect(page1.summary).toEqual(endAug.summary);
    expect(page2.summary).toEqual(endAug.summary);
    // Mid-August: the sold furniture is still held (disposal after the date) with July's depreciation.
    const midAug = await register(accountant, mineQuery('asOfDate=2026-08-15'));
    expect(midAug.data.map((row) => row.assetCode).sort()).toEqual([assets.a.assetCode, assets.b.assetCode, assets.c.assetCode, assets.f.assetCode].sort());
    expectRow(midAug.data.find((row) => row.id === assets.c.id)!, 'c', '2026-08-15');
    expect(midAug.summary).toEqual(registerTotals((['a', 'b', 'c', 'f'] as const).map((key) => registerRowExpectation(specs[key], periodsRun, '2026-08-15'))));
    // Before any run: cost only, NBV = cost. Before the purchases: nothing.
    const endJune = await register(accountant, mineQuery('asOfDate=2026-06-30'));
    expect(endJune.data).toHaveLength(4);
    expect(endJune.data.every((row) => f2(row.accumulatedDeprAt) === '0.00' && row.netBookValueAt === row.purchaseCost)).toBe(true);
    expect((await register(accountant, mineQuery('asOfDate=2026-04-30'))).data).toEqual([]);
    // Explicit status filters and the disposal date.
    const disposed = await register(accountant, mineQuery('asOfDate=2026-08-31&status=DISPOSED'));
    expect(disposed.data.map((row) => row.id)).toEqual([assets.c.id]);
    expect((await register(accountant, mineQuery('asOfDate=2026-08-15&status=DISPOSED'))).data).toEqual([]);
    expect((await register(accountant, mineQuery('asOfDate=2026-08-31&status=WRITTEN_OFF'))).data.map((row) => row.id)).toEqual([assets.f.id]);
    expect((await register(accountant, mineQuery('asOfDate=2026-08-31&category=VEHICLE'))).data.map((row) => row.id)).toEqual([assets.b.id]);
    expect((await register(accountant, mineQuery(`asOfDate=2026-08-15&branchId=${world.branches.b.id}`))).data.map((row) => row.id).sort()).toEqual([assets.c.id, assets.f.id].sort());
    // Same register for every allowed reader and from either work company.
    for (const session of [owner, financeManager, branchManagerA]) expect((await register(session, mineQuery('asOfDate=2026-08-31'))).summary).toEqual(endAug.summary);
    expect((await register(accountant, mineQuery('asOfDate=2026-08-31'), 'FINANCE')).summary).toEqual(endAug.summary);
    // The list endpoint still shows the draft and the reversed asset; the register never does.
    const list = (await api(accountant).get(`/assets?search=${encodeURIComponent(world.prefix)}&limit=50`).expect(200)).body.data;
    const listRows: Asset[] = list.data ?? list;
    expect(listRows.map((row) => row.status).sort()).toEqual(['DISPOSED', 'DRAFT', 'POSTED', 'POSTED', 'REVERSED', 'WRITTEN_OFF']);
    const artifacts = [saveArtifact(DOMAIN, 'asset-register-api.json', JSON.stringify({ endAug: { rows: endAug.data, summary: endAug.summary }, page1: page1.summary, midAug: { rows: midAug.data, summary: midAug.summary }, disposed: disposed.data }, null, 2)).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/register-api`, title: 'GET /assets/register?asOfDate: end of August lists the two held assets with July depreciation (August reversed), sold/written-off assets drop out after their disposal date (mid-August still lists them with their accumulated depreciation), drafts and reversed purchases never appear, rows before any run carry NBV = cost, nothing before the purchases; summary count/cost/accumulated/NBV equal the fixture on every page (limit=1 → identical summary on page 1 and 2); status DISPOSED / WRITTEN_OFF, category and branch filters; identical for OWNER / FINANCE_MANAGER / BRANCH_MANAGER and via ?company=finance; the list endpoint keeps DRAFT / REVERSED', documents: ['ASSET_REGISTER'], routes: ['GET /api/assets/register', 'GET /api/assets'], renderer: 'none', artifacts }));
  }, 180000);

  describe('browser — the real admin web app through the Vite proxy', () => {
    it('/assets/register renders the as-of register with the API totals, prints A4 landscape, follows the as-of date and status filters; /assets/:id previews the receipt with the API bytes, survives closing while loading, and an unknown id shows the error boundary', async () => {
      const docsBefore = await h.prisma.fixedAsset.count({ where: { deletedAt: null, name: { contains: world.prefix } } });
      const journalsBefore = (await Promise.all(Object.values(assets).map((asset) => journalsForAsset(asset.id)))).reduce((count, list) => count + list.length, 0);
      const endAug = await register(accountant, mineQuery('asOfDate=2026-08-31'));
      accountantSession = await openAs(world.users.accountant, `/assets/register?asOfDate=2026-08-31&search=${encodeURIComponent(world.prefix)}`);
      const { page, errors, runtime } = accountantSession;
      await waitForText(page, assets.a.assetCode, 'register-rows');
      await waitForText(page, assets.b.assetCode, 'register-rows-b');
      // The stat cards count up (AnimatedCounter) — wait until they settle on the API totals before reading the page.
      await page.waitForFunction((needles: string[]) => needles.every((needle) => document.body.innerText.includes(needle)), [th(endAug.summary.totalPurchaseCost), th(endAug.summary.totalNbv)], { timeout: 20_000 }).catch(() => undefined);
      const bodyText = await page.locator('body').innerText();
      for (const token of [assets.a.assetCode, assets.b.assetCode, th(endAug.summary.totalPurchaseCost), th(endAug.summary.totalAccumulatedDepr), th(endAug.summary.totalNbv), CUSTODIAN_A2]) expect(bodyText).toContain(token);
      for (const other of [assets.c.assetCode, assets.f.assetCode, assets.d.assetCode, assets.e.assetCode]) expect(bodyText).not.toContain(other);
      const registerShots = await shots(page, 'asset-register');
      const registerPrint = await printToPdf(page, 'asset-register-print');
      expect(registerPrint.pdf.pages.every(isA4Landscape)).toBe(true);
      expectFonts(registerPrint.pdf);
      const registerStream = streamText(registerPrint.pdf);
      for (const token of [assets.a.assetCode, assets.b.assetCode, th(endAug.summary.totalNbv)]) expect(registerStream).toContain(foldThai(token));
      expect(registerStream).not.toContain(foldThai(assets.c.assetCode));
      // Mid-August as-of: the sold furniture is back with July's depreciation; status filter shows the disposal.
      await runtime.navigate(page, `/assets/register?asOfDate=2026-08-15&search=${encodeURIComponent(world.prefix)}`);
      await waitForText(page, assets.c.assetCode, 'register-mid-august');
      expect(await page.locator('body').innerText()).toContain(th(depreciationFor(specs.c, JULY)));
      // In-app navigation keeps the previous rows on screen until the new query resolves — wait for the held asset to leave.
      await runtime.navigate(page, `/assets/register?asOfDate=2026-08-31&status=DISPOSED&search=${encodeURIComponent(world.prefix)}`);
      await waitForText(page, assets.c.assetCode, 'register-disposed');
      await page.waitForFunction((code: string) => !document.body.innerText.includes(code), assets.a.assetCode, { timeout: 30_000 });
      const disposedText = await page.locator('body').innerText();
      expect(disposedText).not.toContain(assets.a.assetCode);
      const disposedShot = saveArtifact(DOMAIN, 'asset-register-disposed-1440.png', await page.screenshot({ fullPage: true })).relativePath;

      // Receipt preview on the detail page — the iframe bytes are the API bytes.
      await runtime.navigate(page, `/assets/${assets.a.id}`);
      await waitForText(page, assets.a.docNo, 'asset-detail');
      const dialog = page.getByRole('dialog');
      const printButton = page.getByRole('button', { name: /พิมพ์/ }).first();
      await printButton.click();
      await dialog.waitFor({ state: 'visible', timeout: 30_000 });
      await dialog.getByText('ตัวอย่างเอกสารสินทรัพย์').first().waitFor({ timeout: 30_000 });
      await dialog.locator('iframe').waitFor({ state: 'attached', timeout: 60_000 });
      await dialog.getByRole('link', { name: /ดาวน์โหลด PDF/ }).waitFor({ state: 'visible', timeout: 30_000 });
      expect(await dialog.getByRole('link', { name: /ดาวน์โหลด PDF/ }).getAttribute('download')).toBe(`${assets.a.assetCode}.pdf`);
      const shown = await parsePdf(await previewBytes(page));
      expect(contentSignature(shown)).toBe(contentSignature((await receipt(accountant, assets.a.id)).pdf));
      const previewShots = await shots(page, 'asset-receipt-preview');
      await dialog.getByRole('button', { name: 'ปิดตัวอย่าง' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      expect(await page.locator('iframe').count()).toBe(0);
      // Close while loading leaves nothing behind; reopening works.
      await printButton.click();
      await dialog.waitFor({ state: 'visible', timeout: 30_000 });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      expect(await page.locator('iframe').count()).toBe(0);
      await printButton.click();
      await dialog.waitFor({ state: 'visible', timeout: 30_000 });
      await dialog.locator('iframe').waitFor({ state: 'attached', timeout: 60_000 });
      await dialog.getByRole('button', { name: 'ปิดตัวอย่าง' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      // Unknown id → error boundary, no document.
      await runtime.navigate(page, '/assets/00000000-0000-4000-8000-000000000000');
      await page.getByRole('alert').first().waitFor({ state: 'visible', timeout: 30_000 });
      expect(await page.locator('iframe').count()).toBe(0);
      const wrongIdShot = saveArtifact(DOMAIN, 'asset-detail-wrong-id-1440.png', await page.screenshot({ fullPage: true })).relativePath;
      // Browsing and printing created no asset and no journal.
      expect(await h.prisma.fixedAsset.count({ where: { deletedAt: null, name: { contains: world.prefix } } })).toBe(docsBefore);
      expect((await Promise.all(Object.values(assets).map((asset) => journalsForAsset(asset.id)))).reduce((count, list) => count + list.length, 0)).toBe(journalsBefore);
      expect(pageErrors(errors)).toEqual([]);
      const artifacts = [...registerShots, registerPrint.printMediaShot, registerPrint.artifact, disposedShot, ...previewShots, wrongIdShot, saveArtifact(DOMAIN, 'asset-register-print.pdf.json', JSON.stringify({ ...pdfSummary(registerPrint.pdf), consoleErrors: errors }, null, 2)).relativePath];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-register-and-receipt`, title: 'AssetRegisterPage with asOfDate/search in the URL: the two held assets, custodian after transfer, stat cards equal the API summary, sold/written-off/reversed/draft absent; print-media PDF A4 landscape in TH Sarabun PSK; mid-August as-of brings the sold furniture back with July depreciation; status=DISPOSED filter; AssetDetailPage → พิมพ์ → PdfPreview of GET /assets/:id/receipt.pdf with the API bytes, download named <assetCode>.pdf, Escape while loading leaves no iframe, unknown id → error boundary; no asset or journal created by browsing', documents: ['ASSET_REGISTER', 'ASSET_RECEIPT'], routes: ['POST /api/auth/login', 'GET /api/assets/register', 'GET /api/assets/:id', 'GET /api/assets/:id/receipt.pdf'], artifacts, notes: `${consoleNote(errors)} · PdfPreview print button stays disabled in headless Chromium (no PDF viewer) — blob bytes compared instead`, unverified: ['iframe.contentWindow.print() and window.print() themselves (browser print dialogs)', 'client-side CSV/XLSX export of the register (exceljs in the browser) — not driven here'] }));
    }, 300000);
  });

  it('no outbound side effects — nothing was sent to LINE / SMS / e-mail while creating, posting, depreciating, disposing or printing', async () => {
    expect(h.external.calls).toEqual([]);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: 'LINE / SMS / e-mail transports recorded zero calls across the whole domain', routes: [], renderer: 'none', artifacts: [] }));
  });
});
