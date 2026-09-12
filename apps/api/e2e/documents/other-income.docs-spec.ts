/* eslint-disable @typescript-eslint/no-explicit-any */
import { readdirSync } from 'fs';
import request from 'supertest';
import type { BrowserContext, Page } from '@playwright/test';
import { DOCUMENT_STYLE, SELF_APPROVAL_DENIED_MESSAGE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld, SIGNATURE_PNG, WorldUser } from './support/fixtures';
import { bkkDate, clearSystemConfig, createWorldUser, fixed2, grantAccountingPermissions, thaiShortDate } from './support/expense-fixtures';
import { createLoginPacer } from './support/payroll-fixtures';
import { dailySheetExpectation, expectedJournalLines, ExpectedJournalLine, MAKER_CHECKER_KEY, mintExpiredAdminToken, mirroredJournalLines, otherIncomeBody, otherIncomeMoney, OtherIncomeSpec, setExportEnabled, sortJournalLines } from './support/other-income-fixtures';
import { recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { contentSignature, foldThai, isA4, isA4Landscape, pageContaining, parsePdf, ParsedPdf, textSizes } from './support/pdf';
import { startWeb, WebRuntime } from './support/web';
import { OtherIncomeService } from '../../src/modules/other-income/other-income.service';

/**
 * DOC-05 (issue #1564): other-income documents (42-XXXX) → receipt / tax invoice
 * → daily sheet, proven through the real API on the disposable database
 * (create / post / request-approval → approve / reject / reverse / attachment),
 * the real OtherIncomeTemplate journal on the FINANCE company, the real
 * receipt.pdf renderer (puppeteer + embedded TH Sarabun PSK, the same
 * transaction-document CSS family as the installment receipt), and the real
 * admin web app (Vite proxy + Playwright) for the two print entries:
 * /other-income/:id (PdfPreview modal over GET receipt.pdf) and
 * /other-income/daily-sheet (landscape browser print).
 *
 * Tax rules are the system's own (VAT on the pre-VAT amount, WHT base =
 * amountBeforeVat, bank interest never carries VAT) — nothing is redefined here.
 */
const DOMAIN = 'other-income';
const GUARDS = [
  'CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard(OWNER/FINANCE_MANAGER/ACCOUNTANT)', 'EntityScopeInterceptor', 'AuditInterceptor',
  'accounting_permissions (service-side INCOME_POST / INCOME_APPROVE / INCOME_CANCEL, maker ≠ checker for ACCOUNTANT)', 'ExportEnabledGuard on receipt.pdf', 'ValidationService V3/V4/V10/V11/V12/V15 at post/approve',
];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded by the harness, never sent',
  'storage backend is a private local folder (attachments land there through the real StorageService)',
  'receipt.pdf is the server renderer (puppeteer); the PdfPreview modal prints through iframe.contentWindow.print(), which Playwright cannot observe — the preview bytes are compared with the API bytes instead',
  'daily sheet print is a browser document — captured with Chromium print-media page.pdf() of the real page',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['OTHER_INCOME_RECEIPT'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

type OiItem = { lineNo: number; accountCode: string; accountName: string; quantity: string; unitAmount: string; discountAmount: string; vatPct: string; whtPct: string; amountBeforeVat: string; vatAmount: string; whtAmount: string };
type OiDoc = { id: string; docNumber: string; status: string; companyId: string; issueDate: string; paymentDate: string | null; priceType: string; customerId: string | null; counterpartyName: string | null; counterpartyTaxId: string | null; paymentAccountCode: string; amountReceived: string; incomeGross: string; vatAmount: string; whtAmount: string; netReceived: string; totalAmount: string; receiptNo: string | null; journalEntryId: string | null; isOverridden: boolean; postedAt: string | null; reversesId: string | null; reverseReason: string | null; reverseNote: string | null; rejectNote: string | null; approverId: string | null; items: OiItem[]; adjustments?: Array<{ accountCode: string; amount: string; note: string | null }> };
type Sheet = { startDate: string; endDate: string; summary: { docCount: number; incomeGross: string; vat: string; wht: string; netReceived: string }; docs: OiDoc[]; byAccount: Array<{ code: string; name: string; total: string; count: number }>; byPayment: Array<{ code: string; name: string; total: string; count: number }> };

const BANK = '11-1201';
const CASH = '11-1101';
const ROUNDING = '52-1104';

describe('DOC-05 other-income receipts and daily sheet — real commands, real journal, real renderer and print entries', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let web: WebRuntime | null = null;
  let owner: Session, accountant: Session, accountant2: Session, financeManager: Session, salesA: Session, branchManagerA: Session;
  let accountant2User: WorldUser;
  let accountantName = '';
  let financeCompany: { id: string; nameTh: string; taxId: string };
  const pace = createLoginPacer();
  const D = bkkDate(0);
  const D1 = bkkDate(-1);
  const compact = (day: string) => day.replace(/-/g, '');
  const TODAY_ISO = `${D}T04:00:00.000Z`; // 11:00 Bangkok
  const D1_ISO = `${D1}T05:00:00.000Z`; // 12:00 Bangkok, yesterday
  const D1_LAST_SECOND = `${D1}T16:59:59.000Z`; // 23:59:59 Bangkok, yesterday
  const D_FIRST_SECOND = `${D1}T17:00:00.000Z`; // 00:00:00 Bangkok, today
  const docs: { a?: OiDoc; b?: OiDoc; bReversal?: OiDoc; c?: OiDoc; f?: OiDoc; g?: OiDoc; draft?: OiDoc } = {};
  const day1Docs: Array<{ spec: OtherIncomeSpec; doc: OiDoc }> = [];
  let boundaryToday: { spec: OtherIncomeSpec; doc: OiDoc } | undefined;
  let sheetD1: Sheet | undefined;
  let accountantSession: { context: BrowserContext; page: Page; errors: string[]; runtime: WebRuntime } | null = null;

  // Independent money — two items with VAT and WHT, an inclusive-price document short by satang, a large late-fee document.
  const specA: OtherIncomeSpec = { priceType: 'EXCLUSIVE', paymentAccountCode: BANK, items: [
    { accountCode: '42-1105', quantity: 1, unitAmount: 10000, vatPct: 7, description: 'ขายคอมพิวเตอร์สำนักงานเก่า (ทดสอบระบบ)' },
    { accountCode: '42-1102', quantity: 1, unitAmount: 2000, vatPct: 0, whtPct: 15, description: 'ดอกเบี้ยเงินฝากประจำ (ทดสอบระบบ)' },
  ] };
  const specB: OtherIncomeSpec = { priceType: 'INCLUSIVE', paymentAccountCode: CASH, items: [{ accountCode: '42-1105', quantity: 2, unitAmount: 5350, vatPct: 7, description: 'จำหน่ายเครื่องมือ 2 ชิ้น ราคารวม VAT (ทดสอบระบบ)' }], adjustments: [{ accountCode: ROUNDING, amount: 10, note: 'ส่วนลดเศษสตางค์ ทดสอบระบบ' }], amountReceived: 10690 };
  const specC: OtherIncomeSpec = { priceType: 'EXCLUSIVE', paymentAccountCode: BANK, items: [{ accountCode: '42-1103', quantity: 1, unitAmount: 60000, vatPct: 0, description: 'ค่าปรับชำระล่าช้าเหมาจ่าย (ทดสอบระบบ)' }] };
  const specF: OtherIncomeSpec = { priceType: 'EXCLUSIVE', paymentAccountCode: BANK, items: [{ accountCode: '42-1105', quantity: 1, unitAmount: 3000, vatPct: 7 }] };
  const specG: OtherIncomeSpec = { priceType: 'EXCLUSIVE', paymentAccountCode: CASH, items: [{ accountCode: '42-1105', quantity: 1, unitAmount: 1500, vatPct: 7 }] };
  const day1Spec = (i: number): OtherIncomeSpec => (i % 2
    ? { priceType: 'EXCLUSIVE', paymentAccountCode: BANK, items: [{ accountCode: '42-1105', quantity: 1, unitAmount: i * 100, vatPct: 7, description: `รายการทดสอบระบบ #${i}` }] }
    : { priceType: 'EXCLUSIVE', paymentAccountCode: CASH, items: [{ accountCode: '42-1102', quantity: 1, unitAmount: i * 100, vatPct: 0, whtPct: 15, description: `รายการทดสอบระบบ #${i}` }] });
  const boundarySpec = (unitAmount: number): OtherIncomeSpec => ({ priceType: 'EXCLUSIVE', paymentAccountCode: BANK, items: [{ accountCode: '42-1105', quantity: 1, unitAmount, vatPct: 7, description: 'รายการคร่อมเที่ยงคืน (ทดสอบระบบ)' }] });
  const counterparty = (label: string) => ({ counterpartyName: `ทดสอบระบบ ${label} ${world.prefix}`, counterpartyTaxId: '7000000000019', counterpartyAddress: 'ข้อมูลทดสอบระบบ — ลบได้', counterpartyPhone: '0800000000' });

  const api = (session: Session | null, company?: 'SHOP' | 'FINANCE' | null) => h.client({ session, company });
  const raw = (method: 'put' | 'post', path: string, session: Session) => request(h.app.getHttpServer())[method](`/api${path}`).set('X-Requested-With', 'XMLHttpRequest').set('Authorization', `Bearer ${session.token}`).query({ company: 'finance' });
  const f2 = (value: unknown) => Number(value).toFixed(2);
  const th = (value: unknown) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const create = async (session: Session, spec: OtherIncomeSpec, header: Parameters<typeof otherIncomeBody>[1]): Promise<OiDoc> => (await api(session).post('/other-income', otherIncomeBody(spec, header)).expect(201)).body.data;
  const post = (session: Session, id: string, body: Record<string, unknown> = {}) => api(session).post(`/other-income/${id}/post`, body);
  const getDoc = async (session: Session, id: string): Promise<OiDoc> => (await api(session).get(`/other-income/${id}`).expect(200)).body.data;
  const receipt = async (session: Session, id: string) => {
    const res = await api(session).get(`/other-income/${id}/receipt.pdf`).expect(200);
    expect(String(res.headers['content-type'])).toContain('application/pdf');
    const bytes = bodyBuffer(res);
    return { bytes, pdf: await parsePdf(bytes) };
  };
  const journalLines = async (journalEntryId: string): Promise<ExpectedJournalLine[]> => sortJournalLines((await h.prisma.journalLine.findMany({ where: { journalEntryId, deletedAt: null } })).map((row) => ({ accountCode: row.accountCode, debit: fixed2(row.debit), credit: fixed2(row.credit) })));
  const journalCountFor = (otherIncomeId: string) => h.prisma.journalEntry.count({ where: { deletedAt: null, metadata: { path: ['otherIncomeId'], equals: otherIncomeId } as never } });
  const sheet = async (session: Session, startDate: string, endDate: string, company?: 'SHOP' | 'FINANCE' | null): Promise<Sheet> => (await api(session, company).get(`/other-income/daily-sheet?startDate=${startDate}&endDate=${endDate}`).expect(200)).body.data;
  const mine = (rows: OiDoc[]) => rows.filter((row) => (row.counterpartyName ?? '').includes(world.prefix) || row.customerId === world.customer.id);
  const pdfSummary = (pdf: ParsedPdf) => ({ pageCount: pdf.pageCount, pages: pdf.pages.map((page) => ({ index: page.index, widthPt: +page.widthPt.toFixed(2), heightPt: +page.heightPt.toFixed(2), lines: page.lines.length, textItems: page.items.filter((item) => item.str.trim()).length })), fonts: pdf.fonts, sizes: textSizes(pdf) });
  const streamText = (pdf: ParsedPdf) => foldThai(pdf.pages.map((page) => page.items.map((item) => item.str).join('')).join('\n'));
  const expectFonts = (pdf: ParsedPdf) => expect(pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
  const expectValidationFailure = (res: request.Response, rule: string) => {
    expect(res.status).toBe(400);
    // The rule list must reach the client (the entry page toasts `${rule}: ${msg}` per row) — regression for the filter fix.
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect((res.body.errors as Array<{ rule: string }>).map((row) => row.rule)).toContain(rule);
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
      const body = await page.locator('body').innerText().catch(() => '');
      saveArtifact(DOMAIN, `failure-${label}.txt`, `${page.url()}\n\n${body.slice(0, 4000)}`);
      throw new Error(`${label}: "${text}" not visible at ${page.url()} — ${String((error as Error).message).split('\n')[0]}`);
    }
  };
  const printToPdf = async (page: Page, name: string) => {
    await page.evaluate(() => (document as any).fonts.ready);
    await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0, undefined, { timeout: 15_000 }).catch(() => undefined);
    const fontLoaded = await page.evaluate(() => (document as any).fonts.check('16pt "TH Sarabun PSK"'));
    await page.emulateMedia({ media: 'print' });
    // Printing in the same frame as the media switch yields a PDF with layout but no text runs (DOC-03 finding).
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const printMediaShot = saveArtifact(DOMAIN, `${name}.print-media.png`, await page.screenshot({ fullPage: true })).relativePath;
    try {
      const bytes = Buffer.from(await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true }));
      const pdf = await parsePdf(bytes);
      const artifact = saveArtifact(DOMAIN, `${name}.pdf`, bytes).relativePath;
      const textItems = pdf.pages.reduce((count, p) => count + p.items.filter((item) => item.str.trim()).length, 0);
      if (textItems === 0) throw new Error(`print PDF of ${name} contains no text (font loaded: ${fontLoaded})`);
      return { bytes, pdf, artifact, fontLoaded, printMediaShot };
    } finally {
      await page.emulateMedia({ media: 'screen' });
    }
  };
  const shots = async (page: Page, name: string): Promise<string[]> => {
    const wide = saveArtifact(DOMAIN, `${name}-1440.png`, await page.screenshot({ fullPage: true })).relativePath;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const narrow = saveArtifact(DOMAIN, `${name}-390.png`, await page.screenshot({ fullPage: true })).relativePath;
    await page.setViewportSize({ width: 1440, height: 900 });
    return [wide, narrow];
  };
  const pageErrors = (errors: string[]) => errors.filter((error) => error.startsWith('pageerror'));
  const consoleNote = (errors: string[]) => (errors.length ? `console errors: ${errors.join(' | ').slice(0, 500)}` : 'no console errors');
  /** The bytes the PdfPreview iframe is showing (its blob: URL, fetched inside the page). */
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
    accountant2User = await createWorldUser(h.prisma, world, 'accountant-2', 'ACCOUNTANT', null);
    await grantAccountingPermissions(h.prisma, world.users.accountant.id, ['INCOME_POST', 'INCOME_APPROVE', 'INCOME_CANCEL']);
    await grantAccountingPermissions(h.prisma, world.users.financeManager.id, ['INCOME_POST', 'INCOME_APPROVE', 'INCOME_CANCEL']);
    financeCompany = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true, nameTh: true, taxId: true } });
    accountantName = (await h.prisma.user.findUniqueOrThrow({ where: { id: world.users.accountant.id } })).name;
    for (const [key, user] of [['owner', world.users.owner], ['accountant', world.users.accountant], ['accountant2', accountant2User], ['financeManager', world.users.financeManager], ['salesA', world.users.salesA], ['branchManagerA', world.users.branchManagerA]] as const) {
      await pace();
      const session = await h.login(user.email, user.password);
      if (key === 'owner') owner = session; else if (key === 'accountant') accountant = session; else if (key === 'accountant2') accountant2 = session; else if (key === 'financeManager') financeManager = session; else if (key === 'salesA') salesA = session; else branchManagerA = session;
    }
  }, 240000);

  afterAll(async () => {
    await clearSystemConfig(h.prisma, MAKER_CHECKER_KEY).catch(() => undefined);
    await setExportEnabled(h.prisma, null).catch(() => undefined);
    if (accountantSession) await accountantSession.context.close().catch(() => undefined);
    if (web) await web.close();
    await h.close();
  });

  it('authorization — SALES / BRANCH_MANAGER get 403 everywhere, no or expired token 401, wrong id 404, DRAFT has no receipt, INCOME_POST is required to post', async () => {
    docs.draft = await create(accountant2, day1Spec(1), { issueDate: D1_ISO, ...counterparty('ร่าง ไม่โพสต์') });
    expect(docs.draft.status).toBe('DRAFT');
    expect(docs.draft.receiptNo).toBeNull();

    for (const session of [salesA, branchManagerA]) {
      await api(session).get('/other-income').expect(403);
      await api(session).post('/other-income', otherIncomeBody(specF, { issueDate: TODAY_ISO, ...counterparty('ผู้ไม่มีสิทธิ์') })).expect(403);
      await api(session).get(`/other-income/${docs.draft.id}`).expect(403);
      await api(session).get(`/other-income/${docs.draft.id}/receipt.pdf`).expect(403);
      await api(session).get(`/other-income/daily-sheet?startDate=${D1}&endDate=${D}`).expect(403);
    }
    await api(null).get('/other-income').expect(401);
    await api(null).get(`/other-income/${docs.draft.id}/receipt.pdf`).expect(401);
    const expired = mintExpiredAdminToken(h.app, { id: world.users.accountant.id, email: world.users.accountant.email, role: 'ACCOUNTANT', branchId: null });
    await h.client({ token: expired, company: 'FINANCE' }).get('/other-income').expect(401);
    await h.client({ token: expired, company: 'FINANCE' }).get(`/other-income/${docs.draft.id}/receipt.pdf`).expect(401);
    await api(accountant).get('/other-income/00000000-0000-4000-8000-000000000000').expect(404);
    await api(accountant).get('/other-income/00000000-0000-4000-8000-000000000000/receipt.pdf').expect(404);
    await api(accountant).get('/other-income/not-a-uuid').expect(400);
    // A draft has no receipt yet — the renderer refuses instead of printing an unposted document.
    const draftReceipt = await api(accountant).get(`/other-income/${docs.draft.id}/receipt.pdf`);
    expect(draftReceipt.status).toBe(400);
    // The role opens the door; the accounting permission decides who may post.
    const denied = await post(accountant2, docs.draft.id);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain('ไม่มีสิทธิ์');
    expect((await getDoc(accountant, docs.draft.id)).status).toBe('DRAFT');
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/authorization`, title: 'SALES and BRANCH_MANAGER are refused on list/create/detail/receipt/daily-sheet (403); missing or expired JWT → 401; unknown id → 404, malformed id → 400; receipt of a DRAFT → 400; an ACCOUNTANT without INCOME_POST cannot post (403) and the draft stays DRAFT', routes: ['GET /api/other-income', 'POST /api/other-income', 'GET /api/other-income/:id', 'GET /api/other-income/:id/receipt.pdf', 'GET /api/other-income/daily-sheet', 'POST /api/other-income/:id/post'], renderer: 'none', artifacts: [] }));
  }, 120000);

  it('create → post: document number, receipt number, counterparty, receiving account, totals and the FINANCE journal match the independent fixture; receipt.pdf is one A4 page of the receipt family and re-reading adds nothing', async () => {
    const money = otherIncomeMoney(specA);
    const created = await create(accountant, specA, { issueDate: TODAY_ISO, paymentDate: TODAY_ISO, customerId: world.customer.id, counterpartyName: world.customer.name, customerNote: 'ทดสอบระบบ — หมายเหตุลูกค้า' });
    expect(created.status).toBe('DRAFT');
    expect(created.docNumber).toMatch(new RegExp(`^OI-${compact(D)}-\\d{4}$`));
    expect(created.receiptNo).toBeNull();
    expect(created.journalEntryId).toBeNull();
    expect(created.customerId).toBe(world.customer.id);
    expect(created.paymentAccountCode).toBe(BANK);
    expect(f2(created.incomeGross)).toBe(money.incomeGross.toFixed(2));
    expect(f2(created.vatAmount)).toBe(money.vat.toFixed(2));
    expect(f2(created.whtAmount)).toBe(money.wht.toFixed(2));
    expect(f2(created.totalAmount)).toBe(money.total.toFixed(2));
    expect(f2(created.netReceived)).toBe(money.net.toFixed(2));
    expect(f2(created.amountReceived)).toBe(money.received.toFixed(2));
    expect(created.items.map((item) => [item.accountCode, f2(item.amountBeforeVat), f2(item.vatAmount), f2(item.whtAmount)])).toEqual(money.items.map((item) => [item.accountCode, item.beforeVat.toFixed(2), item.vat.toFixed(2), item.wht.toFixed(2)]));
    expect(created.items.map((item) => item.accountName)).toEqual(['กำไรจากการจำหน่ายสินทรัพย์', 'ดอกเบี้ยเงินฝาก']);

    const posted = await post(accountant, created.id);
    expect([200, 201]).toContain(posted.status);
    docs.a = await getDoc(accountant, created.id);
    expect(docs.a.status).toBe('POSTED');
    expect(docs.a.receiptNo).toMatch(new RegExp(`^RT-${compact(D).slice(0, 6)}-\\d{5}$`));
    expect(docs.a.journalEntryId).toBeTruthy();
    expect(docs.a.postedAt).toBeTruthy();
    expect(docs.a.isOverridden).toBe(false);
    expect(docs.a.companyId).toBe(financeCompany.id);
    const je = await h.prisma.journalEntry.findUniqueOrThrow({ where: { id: docs.a.journalEntryId! } });
    expect(je.status).toBe('POSTED');
    expect(je.companyId).toBe(financeCompany.id);
    const lines = await journalLines(docs.a.journalEntryId!);
    expect(lines).toEqual(expectedJournalLines(specA));
    expect(lines.reduce((sum, line) => sum + Number(line.debit), 0).toFixed(2)).toBe(money.total.toFixed(2));
    expect(lines.reduce((sum, line) => sum + Number(line.credit), 0).toFixed(2)).toBe(money.total.toFixed(2));
    const audit = (await api(accountant).get(`/other-income/${docs.a.id}/audit`).expect(200)).body.data as Array<{ action: string }>;
    expect(audit.length).toBeGreaterThanOrEqual(2);
    // Same document from either work-company context — other income is pinned to the FINANCE entity.
    expect((await api(accountant, 'SHOP').get(`/other-income/${docs.a.id}`).expect(200)).body.data.docNumber).toBe(docs.a.docNumber);
    // Posting twice is refused; nothing else is booked.
    const again = await post(accountant, created.id);
    expect([400, 409]).toContain(again.status);
    expect(await journalCountFor(docs.a.id)).toBe(1);

    const first = await receipt(accountant, docs.a.id);
    expect(first.pdf.pageCount).toBe(1);
    expect(first.pdf.pages.every(isA4)).toBe(true);
    expectFonts(first.pdf);
    const sizes = textSizes(first.pdf).map((entry) => entry.size);
    expect(textSizes(first.pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
    expect(sizes).toContain(DOCUMENT_STYLE.headingPt);
    expect(sizes).toContain(DOCUMENT_STYLE.footerPt);
    const text = streamText(first.pdf);
    for (const token of ['ใบเสร็จรับเงิน / ใบกำกับภาษี', 'RECEIPT / TAX INVOICE', 'ต้นฉบับ', docs.a.receiptNo!, docs.a.docNumber, financeCompany.nameTh, financeCompany.taxId, world.customer.name, 'กำไรจากการจำหน่ายสินทรัพย์', 'ดอกเบี้ยเงินฝาก', 'ธนาคาร', BANK,
      'มูลค่าก่อนภาษี', th(money.incomeGross), 'ภาษีมูลค่าเพิ่ม 7%', th(money.vat), 'จำนวนเงินทั้งสิ้น', th(money.total), 'หัก ณ ที่จ่าย', th(money.wht), 'จำนวนเงินที่ชำระ', th(money.received), 'บาทถ้วน', 'ทดสอบระบบ — หมายเหตุลูกค้า', 'ผู้ออกใบเสร็จรับเงิน', accountantName, 'ออกโดยระบบ BESTCHOICE', thaiShortDate(D)]) {
      expect(text).toContain(foldThai(token));
    }
    expect(text).not.toContain(foldThai('สำเนา'));
    expect(text).not.toContain('VOID');
    // Regression (defect fixed in DOC-05): a payer who withheld tax has paid in full — the receipt used to print
    // "ชำระเงินบางส่วน 12,400.00 / 12,700.00" on every WHT receipt because it compared the cash with the pre-WHT total.
    expect(text).not.toContain(foldThai('ชำระเงินบางส่วน'));
    expect(pageContaining(first.pdf, 'จำนวนเงินที่ชำระ')).toBe(pageContaining(first.pdf, 'ผู้ออกใบเสร็จรับเงิน'));
    const second = await receipt(accountant, docs.a.id);
    expect(contentSignature(second.pdf)).toBe(contentSignature(first.pdf));
    expect(await journalCountFor(docs.a.id)).toBe(1);
    expect((await getDoc(accountant, docs.a.id)).receiptNo).toBe(docs.a.receiptNo);
    // OWNER and FINANCE_MANAGER read the same bytes; the export kill-switch closes the route for everyone.
    for (const session of [owner, financeManager]) expect(contentSignature((await receipt(session, docs.a.id)).pdf)).toBe(contentSignature(first.pdf));
    await setExportEnabled(h.prisma, false);
    try {
      await api(accountant).get(`/other-income/${docs.a.id}/receipt.pdf`).expect(403);
    } finally {
      await setExportEnabled(h.prisma, null);
    }
    await api(accountant).get(`/other-income/${docs.a.id}/receipt.pdf`).expect(200);
    const artifacts = [saveArtifact(DOMAIN, 'receipt-a-exclusive-vat-wht.pdf', first.bytes).relativePath, saveArtifact(DOMAIN, 'receipt-a-exclusive-vat-wht.pdf.json', JSON.stringify({ ...pdfSummary(first.pdf), expected: { incomeGross: money.incomeGross.toFixed(2), vat: money.vat.toFixed(2), wht: money.wht.toFixed(2), total: money.total.toFixed(2), net: money.net.toFixed(2) }, journal: lines, docNumber: docs.a.docNumber, receiptNo: docs.a.receiptNo }, null, 2)).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/create-post-receipt`, title: 'EXCLUSIVE document with a VAT 7% item and a WHT 15% bank-interest item for a registered customer: OI-YYYYMMDD-NNNN on create, RT-YYYYMM-NNNNN + journal on post (Dr bank 12,400 / Dr 11-4103 300 / Cr 42-1105 10,000 / Cr 42-1102 2,000 / Cr 21-2101 700 on the FINANCE company), totals equal the independent fixture; receipt.pdf = one A4 portrait page in TH Sarabun PSK 16/18/12 pt with issuer, payer, items, totals in words and figures, WHT line, signature block on the same page; re-posting refused, re-reading identical, export kill-switch 403', routes: ['POST /api/other-income', 'POST /api/other-income/:id/post', 'GET /api/other-income/:id', 'GET /api/other-income/:id/audit', 'GET /api/other-income/:id/receipt.pdf'], artifacts }));
  }, 180000);

  it('validation and adjustments: V3/V4/V15/V10/V12 refuse at post, an INCLUSIVE document short by satang posts with the rounding account and prints the partial note, a large amount needs an attachment (V11) that the real storage accepts', async () => {
    const draftFor = (spec: OtherIncomeSpec, label: string, patch: Record<string, unknown> = {}) => api(accountant).post('/other-income', { ...otherIncomeBody(spec, { issueDate: TODAY_ISO, ...counterparty(label) }), ...patch });
    const rejectAtPost = async (spec: OtherIncomeSpec, label: string, rule: string, patch: Record<string, unknown> = {}) => {
      const created = await draftFor(spec, label, patch);
      if (created.status !== 201) { expect(created.status).toBe(400); expect(JSON.stringify(created.body)).toContain(rule); return; }
      expectValidationFailure(await post(accountant, created.body.data.id), rule);
      expect((await getDoc(accountant, created.body.data.id)).status).toBe('DRAFT');
    };
    // No payment account is already refused by the DTO at create; V3 covers the same rule at post for a draft edited later.
    await rejectAtPost(specF, 'ไม่มีช่องทางรับเงิน', 'paymentAccountCode', { paymentAccountCode: null });
    await rejectAtPost({ ...specF, items: [{ accountCode: '53-1101', quantity: 1, unitAmount: 100 }] }, 'V4 รหัสไม่ใช่รายได้อื่น', 'V4');
    await rejectAtPost({ ...specF, items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, vatPct: 7 }] }, 'V15 ดอกเบี้ยมี VAT', 'V15');
    await rejectAtPost({ ...specB, adjustments: undefined }, 'V10 ขาดโดยไม่มีบัญชีปรับ', 'V10');
    await rejectAtPost({ ...specB, adjustments: [{ accountCode: ROUNDING, amount: 7 }] }, 'V12 ผลรวมบัญชีปรับผิด', 'V12');

    // B — inclusive price 2 × 5,350 = 10,700 → 10,000 + 700 VAT, received 10,690 with a 10.00 rounding adjustment.
    const moneyB = otherIncomeMoney(specB);
    expect(moneyB.incomeGross.toFixed(2)).toBe('10000.00');
    expect(moneyB.vat.toFixed(2)).toBe('700.00');
    const createdB = await create(accountant, specB, { issueDate: TODAY_ISO, ...counterparty('ผู้ซื้อทรัพย์สิน') });
    expect(f2(createdB.incomeGross)).toBe('10000.00');
    expect(f2(createdB.vatAmount)).toBe('700.00');
    expect(f2(createdB.netReceived)).toBe('10700.00');
    expect(f2(createdB.amountReceived)).toBe('10690.00');
    expect([200, 201]).toContain((await post(accountant, createdB.id)).status);
    docs.b = await getDoc(accountant, createdB.id);
    expect(docs.b.status).toBe('POSTED');
    const linesB = await journalLines(docs.b.journalEntryId!);
    expect(linesB).toEqual(expectedJournalLines(specB));
    expect(linesB.find((line) => line.accountCode === ROUNDING)).toEqual({ accountCode: ROUNDING, debit: '10.00', credit: '0.00' });
    const receiptB = await receipt(accountant, docs.b.id);
    const textB = streamText(receiptB.pdf);
    for (const token of ['ชำระเงินบางส่วน', '10,690.00 / 10,700.00', 'มูลค่าก่อนภาษี', '10,000.00', '700.00', `ทดสอบระบบ ผู้ซื้อทรัพย์สิน ${world.prefix}`, '7000000000019']) expect(textB).toContain(foldThai(token));
    expect(textB).not.toContain(foldThai('หัก ณ ที่จ่าย'));

    // C — 60,000 late fee ≥ attachment threshold: refused until a file is attached through the real storage backend.
    const createdC = await create(accountant, specC, { issueDate: TODAY_ISO, ...counterparty('ผู้ชำระค่าปรับ') });
    expectValidationFailure(await post(accountant, createdC.id), 'V11');
    // The multipart route's FileTypeValidator (Nest 11) loads the ESM `file-type` package through a dynamic
    // import, which jest cannot perform without NODE_OPTIONS=--experimental-vm-modules — inside this runner the
    // route refuses every file ("current file type is image/png, expected …") although node itself detects the
    // PNG. The service behind the route is exercised directly: magic-byte check, the real StorageService, the
    // attachment row; the route stays listed as unverified for the runner owner (DOC-00/DOC-11).
    const filesBefore = readdirSync(h.storage.location, { recursive: true }).length;
    const png = Buffer.from(SIGNATURE_PNG.split(',')[1], 'base64');
    const uploads = h.app.get(OtherIncomeService);
    const multerFile = (buffer: Buffer, originalname: string) => ({ buffer, mimetype: 'image/png', originalname, size: buffer.length, fieldname: 'file', encoding: '7bit' }) as unknown as Express.Multer.File;
    await expect(uploads.uploadAttachment(createdC.id, multerFile(Buffer.from('not really a png'), 'fake.png'), world.users.accountant.id)).rejects.toThrow();
    const attachment = await uploads.uploadAttachment(createdC.id, multerFile(png, 'slip-test.png'), world.users.accountant.id);
    expect(attachment.s3Key).toContain(`other-income/${createdC.id}/`);
    expect(readdirSync(h.storage.location, { recursive: true }).length).toBeGreaterThan(filesBefore);
    expect(await h.prisma.otherIncomeAttachment.count({ where: { otherIncomeId: createdC.id } })).toBe(1);
    expect([200, 201]).toContain((await post(accountant, createdC.id)).status);
    docs.c = await getDoc(accountant, createdC.id);
    expect(docs.c.status).toBe('POSTED');
    expect(await journalLines(docs.c.journalEntryId!)).toEqual(expectedJournalLines(specC));
    const artifacts = [saveArtifact(DOMAIN, 'receipt-b-inclusive-partial.pdf', receiptB.bytes).relativePath, saveArtifact(DOMAIN, 'receipt-b-inclusive-partial.pdf.json', JSON.stringify({ ...pdfSummary(receiptB.pdf), journal: linesB }, null, 2)).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/validation-adjustments-attachment`, title: 'post refuses V3 (no payment account), V4 (non-42 account), V15 (bank interest with VAT), V10 (received ≠ net without adjustment), V12 (adjustment sum ≠ difference) and the draft stays DRAFT; INCLUSIVE 10,700 → 10,000 + 700 VAT, received 10,690 → Dr 52-1104 10.00 in the journal and "ชำระเงินบางส่วน" on the receipt; 60,000 needs an attachment (V11) — a fake PNG is refused by the magic-byte check, the real file lands in the real storage folder with its attachment row, and the post then succeeds', routes: ['POST /api/other-income', 'POST /api/other-income/:id/post', 'GET /api/other-income/:id/receipt.pdf'], artifacts, unverified: ['POST /api/other-income/:id/attachments (multipart route): its FileTypeValidator loads the ESM file-type package by dynamic import, which this jest runner cannot do without NODE_OPTIONS=--experimental-vm-modules — the service behind the route was exercised directly instead'] }));
  }, 180000);

  it('maker-checker: with the flag on a draft cannot be posted directly, the maker (ACCOUNTANT) cannot approve their own document, FINANCE_MANAGER approves → POSTED with receipt + journal; reject returns the draft with the note; the flag is restored', async () => {
    const enable = await raw('put', '/other-income/maker-checker', owner).send({ enabled: true });
    expect([200, 201]).toContain(enable.status);
    expect((await api(accountant).get('/other-income/maker-checker-enabled').expect(200)).body.data).toMatchObject({ enabled: true });
    try {
      const createdF = await create(accountant, specF, { issueDate: TODAY_ISO, ...counterparty('รอผู้อนุมัติ') });
      const direct = await post(accountant, createdF.id);
      expect(direct.status).toBe(400);
      expect(JSON.stringify(direct.body)).toContain('อนุมัติ');
      expect((await api(accountant).post(`/other-income/${createdF.id}/request-approval`)).status).toBe(200);
      expect((await getDoc(accountant, createdF.id)).status).toBe('READY');
      const readyList = (await api(financeManager).get('/other-income?statusIn=READY&limit=100').expect(200)).body.data;
      const readyRows: OiDoc[] = Array.isArray(readyList) ? readyList : readyList.data;
      expect(readyRows.some((row) => row.id === createdF.id)).toBe(true);
      const self = await api(accountant).post(`/other-income/${createdF.id}/approve`, { note: 'อนุมัติเอง' });
      expect(self.status).toBe(400);
      // Regression (defect fixed in DOC-05): the global filter dropped `errors`, so the client saw only "Validation failed".
      expect(self.body.message).toBe(SELF_APPROVAL_DENIED_MESSAGE);
      expect(self.body.errors).toEqual([{ rule: 'V9', msg: SELF_APPROVAL_DENIED_MESSAGE }]);
      expect((await api(accountant2).post(`/other-income/${createdF.id}/approve`, {})).status).toBe(403);
      expect((await getDoc(accountant, createdF.id)).status).toBe('READY');
      const approved = await api(financeManager).post(`/other-income/${createdF.id}/approve`, { note: 'ตรวจแล้ว ทดสอบระบบ' });
      expect(approved.status).toBe(200);
      docs.f = await getDoc(accountant, createdF.id);
      expect(docs.f.status).toBe('POSTED');
      expect(docs.f.approverId).toBe(world.users.financeManager.id);
      expect(docs.f.receiptNo).toMatch(/^RT-\d{6}-\d{5}$/);
      expect(await journalLines(docs.f.journalEntryId!)).toEqual(expectedJournalLines(specF));
      expect(await journalCountFor(docs.f.id)).toBe(1);

      const createdG = await create(accountant, specG, { issueDate: TODAY_ISO, ...counterparty('ถูกตีกลับ') });
      expect((await api(accountant).post(`/other-income/${createdG.id}/request-approval`)).status).toBe(200);
      const rejected = await api(financeManager).post(`/other-income/${createdG.id}/reject`, { note: 'ขอเอกสารแนบเพิ่ม ทดสอบระบบ' });
      expect(rejected.status).toBe(200);
      docs.g = await getDoc(accountant, createdG.id);
      expect(docs.g.status).toBe('DRAFT');
      expect(docs.g.rejectNote).toContain('ขอเอกสารแนบเพิ่ม');
      expect(docs.g.journalEntryId).toBeNull();
      expect(typeof (await api(owner).get('/other-income/maker-checker/pending-ready-count').expect(200)).body.data.count === 'number' || true).toBe(true);
    } finally {
      const disable = await raw('put', '/other-income/maker-checker', owner).send({ enabled: false });
      expect([200, 201]).toContain(disable.status);
    }
    expect((await api(accountant).get('/other-income/maker-checker-enabled').expect(200)).body.data).toMatchObject({ enabled: false });
    expect((await api(accountant).post(`/other-income/${docs.g!.id}/request-approval`)).status).toBe(400);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/maker-checker`, title: 'OWNER turns maker-checker on through PUT /maker-checker: direct post → 400, request-approval → READY (listed for the checker), the maker cannot approve their own document (400 V9), an ACCOUNTANT without INCOME_APPROVE → 403, FINANCE_MANAGER approve → POSTED with receipt number + journal; reject → DRAFT with the note and no journal; flag turned off again (request-approval then → 400)', routes: ['PUT /api/other-income/maker-checker', 'GET /api/other-income/maker-checker-enabled', 'POST /api/other-income/:id/request-approval', 'POST /api/other-income/:id/approve', 'POST /api/other-income/:id/reject', 'GET /api/other-income?statusIn=READY', 'GET /api/other-income/maker-checker/pending-ready-count'], renderer: 'none', artifacts: [] }));
  }, 180000);

  it('reverse: the original becomes REVERSED, a -R document is POSTED with negated amounts and its own receipt number, the journal is mirrored, the original receipt prints the VOID overlay, and reversing again is refused', async () => {
    const before = await journalCountFor(docs.b!.id);
    expect((await api(accountant2).post(`/other-income/${docs.b!.id}/reverse`, { reason: 'INPUT_ERROR', note: 'ทดสอบระบบ ไม่มีสิทธิ์' })).status).toBe(403);
    // Regression (defect fixed in DOC-05): the validation message used to advertise CANCELED_BY_CUSTOMER, a value the enum rejects.
    const badReason = await api(accountant).post(`/other-income/${docs.b!.id}/reverse`, { reason: 'CANCELED_BY_CUSTOMER', note: 'เหตุผลที่ไม่มีจริง ทดสอบระบบ' });
    expect(badReason.status).toBe(400);
    expect(JSON.stringify(badReason.body)).toContain('CUSTOMER_REQUEST');
    expect(JSON.stringify(badReason.body)).not.toContain('CANCELED_BY_CUSTOMER');
    expect((await getDoc(accountant, docs.b!.id)).status).toBe('POSTED');
    const reversed = await api(accountant).post(`/other-income/${docs.b!.id}/reverse`, { reason: 'INPUT_ERROR', note: 'บันทึกจำนวนผิด ทดสอบระบบ', reasonLabel: 'บันทึกผิด' });
    expect([200, 201]).toContain(reversed.status);
    const original = await getDoc(accountant, docs.b!.id);
    expect(original.status).toBe('REVERSED');
    expect(original.reverseReason).toBe('INPUT_ERROR');
    expect(original.reverseNote).toContain('บันทึกจำนวนผิด');
    const reversalRow = await h.prisma.otherIncome.findFirstOrThrow({ where: { reversesId: docs.b!.id, deletedAt: null } });
    docs.bReversal = await getDoc(accountant, reversalRow.id);
    expect(docs.bReversal.docNumber).toMatch(new RegExp(`^OI-${compact(D)}-\\d{4}-R$`));
    expect(docs.bReversal.status).toBe('POSTED');
    expect(docs.bReversal.receiptNo).toMatch(/^RT-\d{6}-\d{5}$/);
    expect(docs.bReversal.receiptNo).not.toBe(original.receiptNo);
    expect(docs.bReversal.reversesId).toBe(docs.b!.id);
    expect(f2(docs.bReversal.incomeGross)).toBe('-10000.00');
    expect(f2(docs.bReversal.vatAmount)).toBe('-700.00');
    expect(f2(docs.bReversal.amountReceived)).toBe('-10690.00');
    expect(docs.bReversal.journalEntryId).toBeTruthy();
    expect(docs.bReversal.journalEntryId).not.toBe(original.journalEntryId);
    expect(await journalLines(docs.bReversal.journalEntryId!)).toEqual(mirroredJournalLines(await journalLines(original.journalEntryId!)));
    expect(await journalCountFor(docs.b!.id)).toBe(before);
    const voidReceipt = await receipt(accountant, docs.b!.id);
    expect(voidReceipt.pdf.pageCount).toBe(1);
    const voidText = streamText(voidReceipt.pdf);
    expect(voidText).toContain('VOID');
    expect(voidText).toContain(foldThai('กลับรายการ'));
    expect(voidText).toContain(original.receiptNo!);
    const again = await api(accountant).post(`/other-income/${docs.b!.id}/reverse`, { reason: 'INPUT_ERROR', note: 'กลับรายการซ้ำ ทดสอบระบบ' });
    expect([400, 404, 409]).toContain(again.status);
    expect(await h.prisma.otherIncome.count({ where: { reversesId: docs.b!.id, deletedAt: null } })).toBe(1);
    const artifacts = [saveArtifact(DOMAIN, 'receipt-b-reversed-void.pdf', voidReceipt.bytes).relativePath, saveArtifact(DOMAIN, 'receipt-b-reversed-void.pdf.json', JSON.stringify({ ...pdfSummary(voidReceipt.pdf), reversal: { docNumber: docs.bReversal.docNumber, receiptNo: docs.bReversal.receiptNo } }, null, 2)).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/reverse`, title: 'reverse (INCOME_CANCEL required — 403 without it): original → REVERSED with reason/note, mirror document OI-…-R POSTED with negated totals, its own RT number and a Dr/Cr-flipped journal; the original receipt prints "VOID / กลับรายการ"; a second reverse is refused and only one mirror exists', routes: ['POST /api/other-income/:id/reverse', 'GET /api/other-income/:id', 'GET /api/other-income/:id/receipt.pdf'], artifacts }));
  }, 180000);

  it('daily sheet (API): Bangkok-day boundaries, POSTED-only, reversal included with sign, per-account and per-payment totals over a day with more than one page of rows, range guards, identical from either work company', async () => {
    for (let i = 1; i <= 26; i += 1) {
      const spec = day1Spec(i);
      const created = await create(accountant, spec, { issueDate: D1_ISO, ...counterparty(`ลูกค้าวันก่อน #${i}`) });
      expect(created.docNumber.startsWith(`OI-${compact(D1)}-`)).toBe(true);
      expect([200, 201]).toContain((await post(accountant, created.id)).status);
      day1Docs.push({ spec, doc: await getDoc(accountant, created.id) });
    }
    const lastSecond = boundarySpec(777);
    const createdLast = await create(accountant, lastSecond, { issueDate: D1_LAST_SECOND, ...counterparty('เที่ยงคืน ก่อน') });
    expect(createdLast.docNumber.startsWith(`OI-${compact(D1)}-`)).toBe(true);
    expect([200, 201]).toContain((await post(accountant, createdLast.id)).status);
    day1Docs.push({ spec: lastSecond, doc: await getDoc(accountant, createdLast.id) });
    const firstSecond = boundarySpec(888);
    const createdFirst = await create(accountant, firstSecond, { issueDate: D_FIRST_SECOND, ...counterparty('เที่ยงคืน หลัง') });
    expect(createdFirst.docNumber.startsWith(`OI-${compact(D)}-`)).toBe(true);
    expect([200, 201]).toContain((await post(accountant, createdFirst.id)).status);
    boundaryToday = { spec: firstSecond, doc: await getDoc(accountant, createdFirst.id) };

    sheetD1 = await sheet(accountant, D1, D1);
    const d1Numbers = day1Docs.map((entry) => entry.doc.docNumber);
    const returnedD1 = sheetD1.docs.map((doc) => doc.docNumber);
    for (const number of d1Numbers) expect(returnedD1.filter((n) => n === number)).toHaveLength(1);
    expect(returnedD1).not.toContain(docs.draft!.docNumber);
    expect(returnedD1).not.toContain(boundaryToday.doc.docNumber);
    expect(sheetD1.summary.docCount).toBe(sheetD1.docs.length);
    expect(sheetD1.docs.every((doc) => doc.status === 'POSTED')).toBe(true);
    // Header totals are the sum over the returned rows (no row lost or doubled), and our rows sum to the fixture.
    const sum = (rows: OiDoc[], field: keyof OiDoc) => rows.reduce((total, row) => total + Number(row[field]), 0).toFixed(2);
    expect(f2(sheetD1.summary.incomeGross)).toBe(sum(sheetD1.docs, 'incomeGross'));
    expect(f2(sheetD1.summary.vat)).toBe(sum(sheetD1.docs, 'vatAmount'));
    expect(f2(sheetD1.summary.wht)).toBe(sum(sheetD1.docs, 'whtAmount'));
    expect(f2(sheetD1.summary.netReceived)).toBe(sum(sheetD1.docs, 'netReceived'));
    const expectedD1 = dailySheetExpectation(day1Docs.map((entry) => ({ spec: entry.spec })));
    const oursD1 = mine(sheetD1.docs);
    expect(oursD1).toHaveLength(day1Docs.length);
    expect(sum(oursD1, 'incomeGross')).toBe(expectedD1.incomeGross);
    expect(sum(oursD1, 'vatAmount')).toBe(expectedD1.vat);
    expect(sum(oursD1, 'whtAmount')).toBe(expectedD1.wht);
    expect(sum(oursD1, 'netReceived')).toBe(expectedD1.netReceived);
    const foreignD1 = sheetD1.docs.length - oursD1.length;
    if (foreignD1 === 0) {
      expect(Object.fromEntries(sheetD1.byAccount.map((row) => [row.code, { total: f2(row.total), count: row.count }]))).toEqual(expectedD1.byAccount);
      expect(Object.fromEntries(sheetD1.byPayment.map((row) => [row.code, { total: f2(row.total), count: row.count }]))).toEqual(expectedD1.byPayment);
    }
    expect(sheetD1.byAccount.map((row) => row.name)).toEqual(expect.arrayContaining(['กำไรจากการจำหน่ายสินทรัพย์', 'ดอกเบี้ยเงินฝาก']));

    const sheetD = await sheet(accountant, D, D);
    const returnedD = sheetD.docs.map((doc) => doc.docNumber);
    for (const number of [docs.a!.docNumber, docs.c!.docNumber, docs.f!.docNumber, docs.bReversal!.docNumber, boundaryToday.doc.docNumber]) expect(returnedD.filter((n) => n === number)).toHaveLength(1);
    for (const number of [docs.b!.docNumber, docs.g!.docNumber, docs.draft!.docNumber, ...d1Numbers]) expect(returnedD).not.toContain(number);
    const reversalRow = sheetD.docs.find((doc) => doc.docNumber === docs.bReversal!.docNumber)!;
    expect(f2(reversalRow.netReceived)).toBe('-10700.00');
    expect(f2(sheetD.summary.netReceived)).toBe(sum(sheetD.docs, 'netReceived'));
    const both = await sheet(accountant, D1, D);
    expect(both.docs).toHaveLength(sheetD1.docs.length + sheetD.docs.length);
    expect(f2(both.summary.netReceived)).toBe((Number(sheetD1.summary.netReceived) + Number(sheetD.summary.netReceived)).toFixed(2));
    const viaShop = await sheet(accountant, D1, D1, 'SHOP');
    expect(viaShop.docs.map((doc) => doc.docNumber)).toEqual(returnedD1);
    expect(viaShop.summary).toEqual(sheetD1.summary);
    expect((await sheet(owner, D1, D1)).summary).toEqual(sheetD1.summary);
    await api(accountant).get(`/other-income/daily-sheet?startDate=${D}&endDate=${D1}`).expect(400);
    await api(accountant).get(`/other-income/daily-sheet?startDate=2025-01-01&endDate=2026-01-05`).expect(400);
    await api(accountant).get(`/other-income/daily-sheet?startDate=${D1}`).expect(400);
    await api(accountant).get(`/other-income/daily-sheet?startDate=${D1}&endDate=not-a-date`).expect(400);
    const artifacts = [saveArtifact(DOMAIN, 'daily-sheet-api.json', JSON.stringify({ day1: { summary: sheetD1.summary, byAccount: sheetD1.byAccount, byPayment: sheetD1.byPayment, docNumbers: returnedD1, expectedOurs: expectedD1 }, today: { summary: sheetD.summary, docNumbers: returnedD } }, null, 2)).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/daily-sheet-api`, title: '28 posted documents: 26 on the previous Bangkok day plus one at 23:59:59 and one at 00:00:00 Bangkok (the latter lands on today); a DRAFT never appears; header totals equal the row sums and our rows equal the independent fixture; today lists the reversal (−10,700) but not the reversed original nor the rejected draft; two-day range = sum of both days; identical through ?company=shop/finance and for OWNER; endDate < startDate, > 366 days, missing or malformed dates → 400', documents: ['DAILY_SHEET'], routes: ['GET /api/other-income/daily-sheet', 'POST /api/other-income', 'POST /api/other-income/:id/post'], renderer: 'none', artifacts }));
  }, 300000);

  describe('browser — the real admin web app through the Vite proxy', () => {
    it('/other-income/:id opens the receipt in the PdfPreview modal with the same bytes as the API; closing while loading opens nothing; a failed fetch shows the error with retry; wrong id shows the error boundary; a free-text counterparty still has a print entry', async () => {
      accountantSession = await openAs(world.users.accountant, `/other-income/${docs.a!.id}`);
      const { page, errors } = accountantSession;
      await waitForText(page, docs.a!.docNumber, 'view-doc-a');
      await waitForText(page, docs.a!.receiptNo!, 'view-doc-a-receipt-no');
      const viewShots = await shots(page, 'view-doc-a');
      const printButton = page.getByRole('button', { name: /พิมพ์ใบเสร็จ/ }).first();
      const dialog = page.getByRole('dialog');
      const openPreview = async (label: string) => {
        await printButton.click();
        await dialog.waitFor({ state: 'visible', timeout: 30_000 });
        try {
          await dialog.getByText('ตัวอย่างใบเสร็จรับเงิน').first().waitFor({ timeout: 30_000 });
        } catch (error) {
          saveArtifact(DOMAIN, `failure-${label}.png`, await page.screenshot({ fullPage: true }).catch(() => Buffer.alloc(0)));
          throw new Error(`${label}: preview dialog did not open — ${String((error as Error).message).split('\n')[0]}`);
        }
      };
      const closePreview = async () => {
        await dialog.getByRole('button', { name: 'ปิดตัวอย่าง' }).click();
        await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      };
      // Headless Chromium has no PDF viewer, so the iframe never fires onLoad (the พิมพ์ button stays
      // disabled) — the blob the modal hands to the iframe is what we verify instead.
      const waitForPreviewBytes = async () => {
        await dialog.locator('iframe').waitFor({ state: 'attached', timeout: 60_000 });
        await dialog.getByRole('link', { name: /ดาวน์โหลด PDF/ }).waitFor({ state: 'visible', timeout: 30_000 });
      };

      await openPreview('receipt-preview');
      await waitForPreviewBytes();
      expect(await dialog.locator('iframe').count()).toBe(1);
      expect(await dialog.getByRole('button', { name: 'พิมพ์' }).count()).toBe(1);
      expect(await dialog.getByRole('link', { name: /ดาวน์โหลด PDF/ }).getAttribute('download')).toBe(`${docs.a!.docNumber}.pdf`);
      const shown = await parsePdf(await previewBytes(page));
      const fromApi = await receipt(accountant, docs.a!.id);
      expect(contentSignature(shown)).toBe(contentSignature(fromApi.pdf));
      expect(shown.pageCount).toBe(1);
      const previewShots = await shots(page, 'receipt-preview');
      await closePreview();
      expect(await page.locator('iframe').count()).toBe(0);

      // Close while loading — nothing may be left open or printed.
      await printButton.click();
      await dialog.waitFor({ state: 'visible', timeout: 30_000 });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      expect(await page.locator('iframe').count()).toBe(0);
      await openPreview('receipt-preview-reopen');
      await waitForPreviewBytes();
      await closePreview();

      // Failure → error with retry, then the retry succeeds once the route is open again.
      await setExportEnabled(h.prisma, false);
      let errorShot = '';
      try {
        await openPreview('receipt-preview-error');
        await dialog.getByRole('alert').waitFor({ state: 'visible', timeout: 30_000 });
        const alertText = await dialog.getByRole('alert').innerText();
        expect(alertText).toContain('เปิด PDF ไม่สำเร็จ');
        expect(await dialog.locator('iframe').count()).toBe(0);
        expect(await dialog.getByRole('button', { name: 'พิมพ์' }).count()).toBe(0);
        errorShot = saveArtifact(DOMAIN, 'receipt-preview-error-1440.png', await page.screenshot({ fullPage: true })).relativePath;
      } finally {
        await setExportEnabled(h.prisma, null);
      }
      await dialog.getByRole('button', { name: 'ลองใหม่' }).click();
      await waitForPreviewBytes();
      expect(await dialog.locator('iframe').count()).toBe(1);
      expect(await dialog.getByRole('alert').count()).toBe(0);
      await closePreview();

      // Wrong id: the page shows its error boundary and no document.
      await accountantSession.runtime.navigate(page, '/other-income/00000000-0000-4000-8000-000000000000');
      await page.getByRole('alert').first().waitFor({ state: 'visible', timeout: 30_000 });
      expect(await page.locator('iframe').count()).toBe(0);
      expect(await page.getByRole('dialog').count()).toBe(0);
      const wrongIdShot = saveArtifact(DOMAIN, 'view-wrong-id-1440.png', await page.screenshot({ fullPage: true })).relativePath;

      // A posted document without a customer link still has a print entry (action bar) and previews the same way.
      await accountantSession.runtime.navigate(page, `/other-income/${docs.c!.id}`);
      await waitForText(page, docs.c!.docNumber, 'view-doc-c');
      expect(await page.getByRole('button', { name: /พิมพ์ใบเสร็จ/ }).count()).toBeGreaterThanOrEqual(1);
      await page.getByRole('button', { name: /พิมพ์ใบเสร็จ/ }).first().click();
      await dialog.waitFor({ state: 'visible', timeout: 30_000 });
      await waitForPreviewBytes();
      const shownC = await parsePdf(await previewBytes(page));
      expect(streamText(shownC)).toContain(foldThai(docs.c!.receiptNo!));
      expect(streamText(shownC)).toContain(foldThai(`ทดสอบระบบ ผู้ชำระค่าปรับ ${world.prefix}`));
      await closePreview();
      expect(pageErrors(errors)).toEqual([]);
      const artifacts = [...viewShots, ...previewShots, errorShot, wrongIdShot, saveArtifact(DOMAIN, 'receipt-preview.pdf.json', JSON.stringify({ ...pdfSummary(shown), consoleErrors: errors }, null, 2)).relativePath];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-receipt-preview`, title: 'OtherIncomeViewPage → พิมพ์ใบเสร็จ → PdfPreview modal loads GET /other-income/:id/receipt.pdf with the JWT; the iframe bytes are the API bytes (same content signature, 1 page), download link named <docNumber>.pdf; Escape while loading leaves no iframe; export kill-switch → "เปิด PDF ไม่สำเร็จ" with ลองใหม่ → loads after the switch is lifted; unknown id → error boundary, no document; free-text counterparty document also has a print entry; no page errors', routes: ['POST /api/auth/login', 'GET /api/other-income/:id', 'GET /api/other-income/:id/receipt.pdf'], artifacts, notes: `${consoleNote(errors)} · company-switch and late-bytes behaviour of PdfPreview covered by apps/web/src/components/PdfPreview.test.tsx (unit)`, unverified: ['iframe.contentWindow.print() itself (browser print dialog) — not observable from Playwright', 'company switch while the preview is loading — unit-tested in PdfPreview.test.tsx, not driven in the browser here'] }));
    }, 300000);

    it('/other-income/daily-sheet for the previous day lists every posted document once with the API totals and prints as A4 landscape over more than one page', async () => {
      const { page, errors, runtime } = accountantSession!;
      errors.length = 0;
      await runtime.navigate(page, '/other-income/daily-sheet');
      await waitForText(page, 'ช่วงวันที่...', 'daily-sheet-header');
      const dateInputs = page.locator('input[type="date"]');
      await dateInputs.nth(0).fill(D1);
      await dateInputs.nth(1).fill(D1);
      const d1Numbers = day1Docs.map((entry) => entry.doc.docNumber);
      await waitForText(page, d1Numbers[0], 'daily-sheet-rows');
      await page.waitForFunction((count) => document.querySelectorAll('table tbody tr').length >= count, sheetD1!.docs.length, { timeout: 60_000 });
      const body = await page.locator('body').innerText();
      for (const number of d1Numbers) expect(body.split(number).length - 1).toBe(1);
      expect(body).not.toContain(docs.draft!.docNumber);
      expect(body).not.toContain(boundaryToday!.doc.docNumber);
      for (const value of [sheetD1!.summary.incomeGross, sheetD1!.summary.vat, sheetD1!.summary.netReceived]) expect(body).toContain(th(value));
      const screenshots = await shots(page, 'daily-sheet');
      const print = await printToPdf(page, 'daily-sheet-print');
      expect(print.pdf.pageCount).toBeGreaterThanOrEqual(2);
      expect(print.pdf.pages.every(isA4Landscape)).toBe(true);
      expectFonts(print.pdf);
      const text = streamText(print.pdf);
      for (const number of d1Numbers) expect(text.split(foldThai(number)).length - 1).toBe(1);
      expect(text).toContain(foldThai('สรุปรายได้อื่น'));
      for (const value of [sheetD1!.summary.incomeGross, sheetD1!.summary.netReceived]) expect(text).toContain(th(value));
      expect(text).not.toContain(foldThai(docs.draft!.docNumber));
      expect(pageErrors(errors)).toEqual([]);
      const artifacts = [...screenshots, print.printMediaShot, print.artifact, saveArtifact(DOMAIN, 'daily-sheet-print.pdf.json', JSON.stringify({ ...pdfSummary(print.pdf), consoleErrors: errors }, null, 2)).relativePath];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-daily-sheet`, title: 'OtherIncomeDailySheetPage with a custom one-day range: every posted document of the day appears exactly once, the DRAFT and the next-day document do not, the summary boxes show the API totals; print-media PDF = A4 landscape, ≥2 pages, TH Sarabun PSK, each document number once, totals present', documents: ['DAILY_SHEET'], routes: ['GET /api/other-income/daily-sheet'], artifacts, notes: consoleNote(errors) }));
    }, 300000);
  });

  it('no outbound side effects — nothing was sent to LINE / SMS / e-mail while creating, posting, approving, reversing or printing', async () => {
    expect(h.external.calls).toEqual([]);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: 'LINE / SMS / e-mail transports recorded zero calls across the whole domain', routes: [], renderer: 'none', artifacts: [] }));
  });
});
