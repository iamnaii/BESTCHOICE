/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import type { BrowserContext, Page } from '@playwright/test';
import { DOCUMENT_STYLE, SELF_APPROVAL_DENIED_MESSAGE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld, WorldUser } from './support/fixtures';
import {
  bkkDate, clearSystemConfig, createWorldUser, documentMoney, fixed2, grantAccountingPermissions,
  lineMoney, LineSpec, money, pettyCashLineMoney, setSystemConfig, thaiLongDate, thaiShortDate,
} from './support/expense-fixtures';
import { recordScenario, saveArtifact, sha256, ScenarioRecord } from './support/artifacts';
import { contentSignature, foldThai, isA4, pageContaining, parsePdf, ParsedPdf, sizesOfText, textSizes } from './support/pdf';
import { startWeb, WebRuntime } from './support/web';

/**
 * DOC-03 (issue #1562): payment vouchers, petty cash reimbursement sheets and
 * the daily expense summary, produced by the REAL expense-documents commands
 * (create → post / submit → approve / settlement / void) on the disposable
 * database, rendered by the real ExpenseVoucherPdfService (Chromium) through
 * GET /expense-documents/:id/voucher.pdf — the route ExpenseDetailPage's
 * PdfPreview uses — and by the real admin web app for the browser-print
 * entries (/expenses/:id/voucher, /expenses/daily-summary).
 *
 * Nothing on the request path is stubbed. Outbound LINE/SMS/e-mail are
 * recorded by the harness and asserted to stay empty.
 */
const DOMAIN = 'expense-vouchers';
const GUARDS = [
  'CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard', 'BranchGuard',
  'EntityScopeInterceptor', 'AuditInterceptor', 'accounting_permissions (service-side EXPENSE_POST / EXPENSE_APPROVE / EXPENSE_CANCEL)', 'voucher branch scope (service-side, DOC-03)',
];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded by the harness, never sent (approval requests fan out IN_APP notifications only)',
  'private local directory instead of GCS/S3 — voucher PDFs are rendered on demand and never stored',
  'company, branches, users, suppliers and expense documents are synthetic Prisma rows with test markers',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['PAYMENT_VOUCHER'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

type ExpenseLineRow = { lineNo: number; category: string; description: string | null; supplierName?: string | null; amountBeforeVat: string; vatAmount: string; whtAmount: string; whtPercent?: string };
type ExpenseDoc = {
  id: string; number: string; documentType: string; status: string; branchId: string; documentDate: string; paidAt: string | null;
  vendorName: string | null; vendorTaxId: string | null; taxInvoiceNo: string | null; subtotal: string; vatAmount: string; withholdingTax: string;
  totalAmount: string; netPayment: string | null; paymentMethod: string | null; depositAccountCode: string | null; journalEntryId: string | null;
  approvedById: string | null; createdById: string; expenseDetail?: { lines: ExpenseLineRow[] } | null; branch?: { name: string };
  createdBy?: { name: string }; approvedBy?: { name: string } | null;
};
type JeLine = { accountCode: string; debit: string; credit: string };

const VOUCHER_TITLE = 'ใบสำคัญจ่าย';
const VOID_OVERLAY = 'ยกเลิก / กลับรายการแล้ว';
const KBANK = '11-1201';
const CASH_DRAWER = '11-1101';
const PETTY_CASH_FLOAT = '11-1103';
const VENDOR_TAX_ID = { juristic: '0000000000201', contractor: '0000000000202', supplier: '0000000000203', individual: '1000000000204', trainer: '1000000000209' };

describe('DOC-03 expense vouchers, petty cash and daily summary — real commands, real renderer, real download route', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let web: WebRuntime | null = null;
  let owner: Session, accountant: Session, financeManager: Session, branchManagerA: Session, branchManagerB: Session, salesA: Session;
  let branchManagerBUser: WorldUser;
  const today = bkkDate(0);
  const summaryDate = bkkDate(-3);
  const docs: { cash?: ExpenseDoc; approved?: ExpenseDoc; accrual?: ExpenseDoc; settlement?: ExpenseDoc; long?: ExpenseDoc; petty?: ExpenseDoc; voided?: ExpenseDoc; draft?: ExpenseDoc } = {};
  const dailyDocs: Array<{ id: string; number: string; type: string; total: string; net: string | null; paymentMethod: string | null; depositAccountCode: string | null; paidInDay: boolean; lines: Array<{ category: string; base: string }> }> = [];

  const api = (session: Session | null, company?: 'SHOP' | 'FINANCE' | null) => h.client({ session, company });
  const getDoc = async (session: Session, id: string): Promise<ExpenseDoc> => (await api(session).get(`/expense-documents/${id}`).expect(200)).body.data;
  const createExpense = async (session: Session, input: { branchId: string; documentDate: string; vendorName: string; vendorTaxId?: string; taxInvoiceNo?: string; whtFormType?: 'PND3' | 'PND53'; paymentMethod?: string; depositAccountCode?: string; description?: string; note?: string; lines: LineSpec[] }): Promise<ExpenseDoc> => {
    const response = await api(session).post('/expense-documents', {
      documentType: 'EXPENSE', ...input,
      lines: input.lines.map((line) => ({ category: line.category, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount, vatPercent: line.vatPercent, whtPercent: line.whtPercent, whtFormType: line.whtFormType })),
    }).expect(201);
    return response.body.data;
  };
  const postDoc = (session: Session, id: string) => api(session).post(`/expense-documents/${id}/post`);
  const voucherPdf = async (session: Session, id: string, company?: 'SHOP' | 'FINANCE' | null) => {
    const response = await api(session, company).get(`/expense-documents/${id}/voucher.pdf`).expect(200).expect('Content-Type', /application\/pdf/);
    const bytes = bodyBuffer(response);
    return { bytes, pdf: await parsePdf(bytes), headers: response.headers as Record<string, string> };
  };
  const journalLines = async (journalEntryId: string): Promise<JeLine[]> => {
    const rows = await h.prisma.journalLine.findMany({ where: { journalEntryId, deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { accountCode: 'asc' }] });
    return rows.map((row) => ({ accountCode: row.accountCode, debit: fixed2(row.debit), credit: fixed2(row.credit) }));
  };
  const balanced = (lines: JeLine[]) => ({ debit: lines.reduce((sum, line) => sum + Number(line.debit), 0).toFixed(2), credit: lines.reduce((sum, line) => sum + Number(line.credit), 0).toFixed(2) });
  const pdfSummary = (pdf: ParsedPdf) => ({ pageCount: pdf.pageCount, pages: pdf.pages.map((page) => ({ index: page.index, widthPt: +page.widthPt.toFixed(2), heightPt: +page.heightPt.toFixed(2), lines: page.lines.length, textItems: page.items.filter((item) => item.str.trim()).length })), fonts: pdf.fonts, sizes: textSizes(pdf) });
  const expectVoucherTypography = (pdf: ParsedPdf) => {
    expect(pdf.pages.every(isA4)).toBe(true);
    expect(pdf.fonts.length).toBeGreaterThan(0);
    expect(pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
    expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
    expect(sizesOfText(pdf, VOUCHER_TITLE)).toContain(DOCUMENT_STYLE.headingPt);
    expect(sizesOfText(pdf, 'PAYMENT VOUCHER')).toContain(DOCUMENT_STYLE.footerPt);
    expect(sizesOfText(pdf, 'ออกโดยระบบ BESTCHOICE')).toContain(DOCUMENT_STYLE.footerPt);
  };
  /** Baseline-grouped text (label + value on one row) — for numbers, dates and single-line labels. */
  const allText = (pdf: ParsedPdf) => foldThai(pdf.pages.map((page) => page.text).join('\n'));
  const expectText = (pdf: ParsedPdf, ...needles: string[]) => { for (const needle of needles) expect(allText(pdf)).toContain(foldThai(needle)); };
  /** Content-stream text (paint order) — for names and free text that wrap over several lines inside a grid cell. */
  const streamText = (pdf: ParsedPdf) => foldThai(pdf.pages.map((page) => page.items.map((item) => item.str).join('')).join('\n'));
  const expectStream = (pdf: ParsedPdf, ...needles: string[]) => { for (const needle of needles) expect(streamText(pdf)).toContain(foldThai(needle)); };

  // Browser helpers — the real admin app (Vite dev server, /api proxied to this harness) driven by Playwright Chromium.
  // One real login per context; later pages use in-app routing (POST /auth/refresh is throttled 10/min per IP).
  // POST /auth/login is throttled 10/min per IP as well and every context here shares one IP with the
  // API logins of beforeAll, so a login waits for a free slot instead of landing on a 429 login form.
  const loginTimes: number[] = [];
  const loginSlot = async () => {
    const window = 65_000;
    for (;;) {
      const now = Date.now();
      while (loginTimes.length && now - loginTimes[0] > window) loginTimes.shift();
      if (loginTimes.length < 9) break;
      await new Promise((resolve) => setTimeout(resolve, loginTimes[0] + window - now + 250));
    }
    loginTimes.push(Date.now());
  };
  const ensureWeb = async () => { if (!web) web = await startWeb(h); return web; };
  const openAs = async (user: WorldUser, path: string, viewport = { width: 1440, height: 900 }) => {
    const runtime = await ensureWeb();
    const { context, page, errors } = await runtime.page(viewport);
    await loginSlot();
    await runtime.login(page, user.email, user.password);
    await runtime.navigate(page, path);
    return { context, page, errors, runtime };
  };
  const waitForText = async (page: Page, text: string, label: string, timeout = 60_000) => {
    try {
      await page.getByText(text).first().waitFor({ state: 'visible', timeout });
    } catch (error) {
      const url = page.url();
      saveArtifact(DOMAIN, `failure-${label}.png`, await page.screenshot({ fullPage: true }).catch(() => Buffer.alloc(0)));
      const body = await page.locator('body').innerText().catch(() => '');
      saveArtifact(DOMAIN, `failure-${label}.txt`, `${url}\n\n${body.slice(0, 4000)}`);
      throw new Error(`${label}: "${text}" not visible at ${url} — ${String((error as Error).message).split('\n')[0]}`);
    }
  };
  /**
   * Print-media PDF of the current page (window.print() cannot be captured). Chromium's
   * printToPDF is the same engine the browser print dialog uses; the page must yield real
   * text runs (TH Sarabun PSK glyphs), so a variant without text is kept as evidence and
   * the next one is tried.
   */
  const printToPdf = async (page: Page, name: string) => {
    await page.evaluate(() => (document as any).fonts.ready);
    // A lingering "เข้าสู่ระบบสำเร็จ" toast would end up on paper — let it expire like a user would.
    await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0, undefined, { timeout: 15_000 }).catch(() => undefined);
    const fontLoaded = await page.evaluate(() => (document as any).fonts.check('16pt "TH Sarabun PSK"'));
    await page.emulateMedia({ media: 'print' });
    const printMediaShot = saveArtifact(DOMAIN, `${name}.print-media.png`, await page.screenshot({ fullPage: true })).relativePath;
    const variants: Array<{ label: string; run: () => Promise<Uint8Array> }> = [
      { label: 'css-page-size', run: () => page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true }) },
      { label: 'a4', run: () => page.pdf({ format: 'A4', printBackground: true }) },
    ];
    const tried: string[] = [];
    try {
      for (const variant of variants) {
        const bytes = Buffer.from(await variant.run());
        const pdf = await parsePdf(bytes);
        const textItems = pdf.pages.reduce((count, p) => count + p.items.filter((item) => item.str.trim()).length, 0);
        const artifact = saveArtifact(DOMAIN, `${name}.${variant.label}.pdf`, bytes).relativePath;
        tried.push(`${variant.label}: ${pdf.pageCount} page(s), ${textItems} text item(s)`);
        if (textItems > 0) return { bytes, pdf, artifact, variant: variant.label, fontLoaded, printMediaShot, tried };
      }
    } finally {
      await page.emulateMedia({ media: 'screen' });
    }
    throw new Error(`print PDF of ${name} contains no text — ${tried.join('; ')} (font loaded: ${fontLoaded})`);
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

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    branchManagerBUser = await createWorldUser(h.prisma, world, 'manager-b', 'BRANCH_MANAGER', world.branches.b.id);
    await grantAccountingPermissions(h.prisma, world.users.accountant.id, ['EXPENSE_POST', 'EXPENSE_APPROVE', 'EXPENSE_CANCEL']);
    await grantAccountingPermissions(h.prisma, world.users.financeManager.id, ['EXPENSE_POST', 'EXPENSE_APPROVE']);
    await grantAccountingPermissions(h.prisma, world.users.branchManagerA.id, ['EXPENSE_POST']);
    for (const [key, user] of [['owner', world.users.owner], ['accountant', world.users.accountant], ['financeManager', world.users.financeManager], ['branchManagerA', world.users.branchManagerA], ['branchManagerB', branchManagerBUser], ['salesA', world.users.salesA]] as const) {
      await loginSlot();
      const session = await h.login(user.email, user.password);
      if (key === 'owner') owner = session; else if (key === 'accountant') accountant = session; else if (key === 'financeManager') financeManager = session;
      else if (key === 'branchManagerA') branchManagerA = session; else if (key === 'branchManagerB') branchManagerB = session; else salesA = session;
    }
  }, 180000);

  afterAll(async () => {
    await web?.close();
    await h?.close();
  });

  it('logs every actor in through POST /auth/login; accounting grants come from the real SystemConfig policy', async () => {
    expect(accountant.user.role).toBe('ACCOUNTANT');
    expect([...accountant.user.accessibleCompanies].sort()).toEqual(['FINANCE', 'SHOP']);
    expect(branchManagerB.user.accessibleCompanies).toEqual(['SHOP']);
    expect(branchManagerB.user.branchId).toBe(world.branches.b.id);
    const me = await api(branchManagerA).get('/auth/me').expect(200);
    expect(me.body.data.branchId).toBe(world.branches.a.id);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/login`, title: 'Real login for OWNER / ACCOUNTANT / FINANCE_MANAGER / two BRANCH_MANAGERs / SALES; EXPENSE_* grants via accounting_permissions', routes: ['POST /api/auth/login', 'GET /api/auth/me'], renderer: 'none', artifacts: [] }));
  });

  it('posts a same-day cash expense (mixed VAT / WHT lines, PND53) and prints the voucher with every persisted figure', async () => {
    const lines: LineSpec[] = [
      { category: '53-1201', description: 'ทดสอบระบบ เครื่องเขียนสำนักงาน', quantity: 10, unitPrice: 250, vatPercent: 7 },
      { category: '53-1105', description: 'ทดสอบระบบ ค่าอบรมพนักงาน', quantity: 1, unitPrice: 12000, discount: 500, vatPercent: 7, whtPercent: 3 },
      { category: '53-1106', description: 'ทดสอบระบบ อาหารว่างประชุม', quantity: 4, unitPrice: 1500, vatPercent: 0, whtPercent: 1 },
    ];
    const expectedLines = lines.map((line) => lineMoney(line));
    const expected = documentMoney(expectedLines);
    expect(fixed2(expected.subtotal)).toBe('20000.00');
    expect(fixed2(expected.vatAmount)).toBe('980.00');
    expect(fixed2(expected.withholdingTax)).toBe('405.00');
    expect(fixed2(expected.totalAmount)).toBe('20980.00');
    expect(fixed2(expected.netPayment)).toBe('20575.00');

    const vendorName = `ทดสอบระบบ บริษัท ผู้ขายอุปกรณ์ จำกัด ${world.prefix}`;
    const created = await createExpense(accountant, {
      branchId: world.branches.a.id, documentDate: today, vendorName, vendorTaxId: VENDOR_TAX_ID.juristic,
      taxInvoiceNo: `TEST-INV-${world.prefix}-A`, whtFormType: 'PND53', paymentMethod: 'BANK_TRANSFER', depositAccountCode: KBANK,
      description: 'ทดสอบระบบ ค่าใช้จ่ายสำนักงานประจำเดือน', lines,
    });
    expect(created.status).toBe('DRAFT');
    expect(created.number).toMatch(/^EX-\d{4}-\d{3,}$/);
    expect(fixed2(created.subtotal)).toBe(fixed2(expected.subtotal));
    expect(fixed2(created.vatAmount)).toBe(fixed2(expected.vatAmount));
    expect(fixed2(created.withholdingTax)).toBe(fixed2(expected.withholdingTax));
    expect(fixed2(created.totalAmount)).toBe(fixed2(expected.totalAmount));
    expect(fixed2(created.netPayment!)).toBe(fixed2(expected.netPayment));
    expect(created.expenseDetail!.lines.map((line) => [fixed2(line.amountBeforeVat), fixed2(line.vatAmount), fixed2(line.whtAmount)])).toEqual(expectedLines.map((line) => [fixed2(line.amountBeforeVat), fixed2(line.vatAmount), fixed2(line.whtAmount)]));

    // A voucher must not exist before the payment is recognised in the books.
    const early = await api(accountant).get(`/expense-documents/${created.id}/voucher.pdf`).expect(400);
    expect(early.headers['content-type']).toMatch(/json/);
    expect(early.body.message).toContain('ยังไม่ได้บันทึกจ่าย');

    await api(salesA).post(`/expense-documents/${created.id}/post`).expect(403);
    await api(branchManagerB).post(`/expense-documents/${created.id}/post`).expect(403);
    const posted = await postDoc(accountant, created.id).expect(201);
    expect(posted.body.data.entryNo).toMatch(/^JE-/);
    const doc = await getDoc(accountant, created.id);
    docs.cash = doc;
    expect(doc.status).toBe('POSTED');
    expect(doc.paidAt).not.toBeNull();
    expect(doc.approvedById).toBeNull();
    expect(doc.journalEntryId).toBeTruthy();
    const je = await journalLines(doc.journalEntryId!);
    expect(je).toEqual(expect.arrayContaining([
      { accountCode: '53-1201', debit: '2500.00', credit: '0.00' },
      { accountCode: '53-1105', debit: '11500.00', credit: '0.00' },
      { accountCode: '53-1106', debit: '6000.00', credit: '0.00' },
      { accountCode: '11-4101', debit: '980.00', credit: '0.00' },
      { accountCode: KBANK, debit: '0.00', credit: '20575.00' },
      { accountCode: '21-3103', debit: '0.00', credit: '405.00' },
    ]));
    expect(je).toHaveLength(6);
    expect(balanced(je)).toEqual({ debit: '20980.00', credit: '20980.00' });
    // Posting twice cannot create a second journal entry.
    await postDoc(accountant, created.id).expect(400);
    expect((await getDoc(accountant, created.id)).journalEntryId).toBe(doc.journalEntryId);

    const { bytes, pdf, headers } = await voucherPdf(accountant, created.id);
    expect(headers['content-disposition']).toBe(`inline; filename="expense-voucher-${created.id}.pdf"`);
    expect(Number(headers['content-length'])).toBe(bytes.length);
    expectVoucherTypography(pdf);
    expect(pdf.pageCount).toBe(1);
    expectText(pdf, doc.number, `วันที่ ${thaiShortDate(today)}`, `วันที่จ่าย ${thaiShortDate(today)}`, `เลขประจำตัวผู้เสียภาษี ${VENDOR_TAX_ID.juristic}`, `เลขใบกำกับ TEST-INV-${world.prefix}-A`,
      'ผู้จัดทำ', 'ผู้อนุมัติ', 'ผู้รับเงิน', '53-1201', '53-1105', '53-1106', '10.00', '250.00', '500.00', '2,500.00', '11,500.00', '6,000.00',
      'มูลค่าก่อนภาษี 20,000.00', 'ภาษีมูลค่าเพิ่ม 7% 980.00', 'มูลค่ารวม 20,980.00', 'หัก ณ ที่จ่าย 405.00', 'จำนวนเงินจ่ายสุทธิ 20,575.00 บาท', 'สองหมื่นห้าร้อยเจ็ดสิบห้าบาทถ้วน');
    expectStream(pdf, vendorName, world.branches.a.name, 'ทดสอบระบบ ACCOUNTANT accountant', 'ทดสอบระบบ บริษัทไฟแนนซ์', 'ทดสอบระบบ เครื่องเขียนสำนักงาน', 'ทดสอบระบบ ค่าอบรมพนักงาน', 'ทดสอบระบบ อาหารว่างประชุม', 'ทดสอบระบบ ค่าใช้จ่ายสำนักงานประจำเดือน');
    expect(allText(pdf)).not.toContain(foldThai(VOID_OVERLAY));
    const closing = pageContaining(pdf, 'จำนวนเงินจ่ายสุทธิ (ตัวอักษร)');
    expect(closing).toBe(pdf.pageCount);
    expect(pageContaining(pdf, 'สแกนเพื่อตรวจสอบ')).toBe(closing);
    const artifacts = [
      saveArtifact(DOMAIN, 'voucher-cash-pnd53.pdf', bytes).relativePath,
      saveArtifact(DOMAIN, 'voucher-cash-pnd53.pdf.json', JSON.stringify({ document: doc, expected: { subtotal: fixed2(expected.subtotal), vat: fixed2(expected.vatAmount), wht: fixed2(expected.withholdingTax), total: fixed2(expected.totalAmount), net: fixed2(expected.netPayment) }, journal: je, ...pdfSummary(pdf) }, null, 2)).relativePath,
    ];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/cash-expense-voucher`, title: 'EXPENSE DRAFT → POST (same-day cash): totals match independent fixture, JE balanced with WHT routed to 21-3103, voucher shows number/dates/vendor/branch/preparer/lines/totals/Thai amount on one A4 page', routes: ['POST /api/expense-documents', 'POST /api/expense-documents/:id/post', 'GET /api/expense-documents/:id', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts, notes: `sha256=${sha256(bytes)}` }));
  });

  it('routes a document over the approval threshold through submit → approve (maker≠checker) and prints the approver on the voucher', async () => {
    await setSystemConfig(h.prisma, 'approval_enabled', 'true');
    try {
      const lines: LineSpec[] = [{ category: '53-1201', description: 'ทดสอบระบบ ปรับปรุงสำนักงานทั้งชั้น', quantity: 1, unitPrice: 60000, vatPercent: 7 }];
      const expected = documentMoney(lines.map((line) => lineMoney(line)));
      expect(fixed2(expected.totalAmount)).toBe('64200.00');
      const vendorName = `ทดสอบระบบ ห้างหุ้นส่วน รับเหมา ${world.prefix}`;
      const created = await createExpense(accountant, { branchId: world.branches.a.id, documentDate: today, vendorName, vendorTaxId: VENDOR_TAX_ID.contractor, paymentMethod: 'CASH', depositAccountCode: CASH_DRAWER, lines });
      const blocked = await postDoc(accountant, created.id).expect(400);
      expect(blocked.body.message).toContain('ต้องผ่านการอนุมัติก่อน');
      const submitted = await api(accountant).post(`/expense-documents/${created.id}/submit-for-approval`).expect(201);
      expect(submitted.body.data.status).toBe('PENDING_APPROVAL');
      const selfApprove = await api(accountant).post(`/expense-documents/${created.id}/approve`).expect(403);
      expect(selfApprove.body.message).toBe(SELF_APPROVAL_DENIED_MESSAGE);
      await api(branchManagerB).post(`/expense-documents/${created.id}/approve`).expect(403);
      await api(financeManager).post(`/expense-documents/${created.id}/approve`).expect(201);
      const doc = await getDoc(accountant, created.id);
      docs.approved = doc;
      expect(doc.status).toBe('POSTED');
      expect(doc.approvedById).toBe(world.users.financeManager.id);
      expect(doc.createdById).toBe(world.users.accountant.id);
      const audit = await h.prisma.auditLog.findMany({ where: { entityId: created.id, entity: 'expense_document' }, orderBy: { createdAt: 'asc' }, select: { action: true, userId: true } });
      expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['APPROVAL_REQUESTED', 'APPROVED', 'AUTO_POSTED']));
      expect(audit.find((row) => row.action === 'APPROVED')?.userId).toBe(world.users.financeManager.id);
      const je = await journalLines(doc.journalEntryId!);
      expect(je).toEqual(expect.arrayContaining([
        { accountCode: '53-1201', debit: '60000.00', credit: '0.00' },
        { accountCode: '11-4101', debit: '4200.00', credit: '0.00' },
        { accountCode: CASH_DRAWER, debit: '0.00', credit: '64200.00' },
      ]));
      expect(je).toHaveLength(3);

      const { bytes, pdf } = await voucherPdf(financeManager, created.id);
      expectVoucherTypography(pdf);
      expectText(pdf, doc.number, 'จำนวนเงินจ่ายสุทธิ 64,200.00 บาท', 'หกหมื่นสี่พันสองร้อยบาทถ้วน', 'หัก ณ ที่จ่าย 0.00', `เลขประจำตัวผู้เสียภาษี ${VENDOR_TAX_ID.contractor}`);
      expectStream(pdf, vendorName, 'ทดสอบระบบ ACCOUNTANT accountant', 'ทดสอบระบบ FINANCE_MANAGER finance');
      const artifacts = [
        saveArtifact(DOMAIN, 'voucher-approved.pdf', bytes).relativePath,
        saveArtifact(DOMAIN, 'voucher-approved.pdf.json', JSON.stringify({ document: doc, audit, journal: je, ...pdfSummary(pdf) }, null, 2)).relativePath,
      ];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/approval-workflow`, title: 'approval_enabled: post from DRAFT refused, ACCOUNTANT cannot approve own document, FINANCE_MANAGER approves → auto-post; voucher prints preparer and approver', routes: ['POST /api/expense-documents/:id/post', 'POST /api/expense-documents/:id/submit-for-approval', 'POST /api/expense-documents/:id/approve', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts }));
    } finally {
      await clearSystemConfig(h.prisma, 'approval_enabled');
    }
  });

  it('books an accrual, clears it with a vendor settlement carrying WHT (PND3) and prints both vouchers', async () => {
    const vendorName = `ทดสอบระบบ ร้านอาหาร บุคคลธรรมดา ${world.prefix}`;
    const accrualLines: LineSpec[] = [{ category: '53-1106', description: 'ทดสอบระบบ ค่าอาหารพนักงานรายเดือน', quantity: 2, unitPrice: 3000 }];
    const accrual = await createExpense(accountant, { branchId: world.branches.a.id, documentDate: today, vendorName, vendorTaxId: VENDOR_TAX_ID.individual, lines: accrualLines });
    expect(accrual.netPayment).toBeNull();
    await postDoc(accountant, accrual.id).expect(201);
    let accrualDoc = await getDoc(accountant, accrual.id);
    expect(accrualDoc.status).toBe('ACCRUAL');
    expect(accrualDoc.paidAt).toBeNull();
    expect(await journalLines(accrualDoc.journalEntryId!)).toEqual(expect.arrayContaining([
      { accountCode: '53-1106', debit: '6000.00', credit: '0.00' },
      { accountCode: '21-1104', debit: '0.00', credit: '6000.00' },
    ]));
    const unpaid = await api(accountant).get(`/expense-documents/${accrual.id}/voucher.pdf`).expect(400);
    expect(unpaid.headers['content-type']).toMatch(/json/);

    const settlementInput = { branchId: world.branches.a.id, documentDate: today, vendorName, description: 'ทดสอบระบบ จ่ายเจ้าหนี้ค่าอาหาร', depositAccountCode: KBANK, paymentMethod: 'BANK_TRANSFER', withholdingTax: 180, whtFormType: 'PND3', lines: [{ clearedDocumentId: accrual.id, amountSettled: 6000 }] };
    await api(branchManagerA).post('/expense-documents/settlement', settlementInput).expect(403);
    const settlement = (await api(accountant).post('/expense-documents/settlement', settlementInput).expect(201)).body.data as ExpenseDoc;
    expect(settlement.documentType).toBe('VENDOR_SETTLEMENT');
    expect(settlement.number).toMatch(/^SE-\d{4}-\d{3,}$/);
    expect(fixed2(settlement.totalAmount)).toBe('6000.00');
    expect(fixed2(settlement.withholdingTax)).toBe('180.00');
    expect(fixed2(settlement.netPayment!)).toBe('5820.00');
    await postDoc(accountant, settlement.id).expect(201);
    const settlementDoc = await getDoc(accountant, settlement.id);
    docs.settlement = settlementDoc;
    expect(settlementDoc.status).toBe('POSTED');
    const je = await journalLines(settlementDoc.journalEntryId!);
    expect(je).toEqual(expect.arrayContaining([
      { accountCode: '21-1104', debit: '6000.00', credit: '0.00' },
      { accountCode: KBANK, debit: '0.00', credit: '5820.00' },
      { accountCode: '21-3102', debit: '0.00', credit: '180.00' },
    ]));
    expect(je).toHaveLength(3);
    accrualDoc = await getDoc(accountant, accrual.id);
    docs.accrual = accrualDoc;
    expect(accrualDoc.status).toBe('POSTED');
    expect(accrualDoc.paidAt).not.toBeNull();

    const settlementVoucher = await voucherPdf(accountant, settlement.id);
    expectVoucherTypography(settlementVoucher.pdf);
    expectText(settlementVoucher.pdf, settlementDoc.number, 'มูลค่าก่อนภาษี 6,000.00', 'หัก ณ ที่จ่าย 180.00', 'จำนวนเงินจ่ายสุทธิ 5,820.00 บาท', 'ห้าพันแปดร้อยยี่สิบบาทถ้วน');
    expectStream(settlementVoucher.pdf, vendorName, 'ทดสอบระบบ จ่ายเจ้าหนี้ค่าอาหาร');
    const clearedVoucher = await voucherPdf(accountant, accrual.id);
    expectVoucherTypography(clearedVoucher.pdf);
    expectText(clearedVoucher.pdf, accrualDoc.number, '53-1106', '6,000.00', `วันที่จ่าย ${thaiShortDate(today)}`, 'จำนวนเงินจ่ายสุทธิ 6,000.00 บาท', 'หกพันบาทถ้วน');
    expectStream(clearedVoucher.pdf, vendorName, 'ทดสอบระบบ ค่าอาหารพนักงานรายเดือน');
    const artifacts = [
      saveArtifact(DOMAIN, 'voucher-settlement-pnd3.pdf', settlementVoucher.bytes).relativePath,
      saveArtifact(DOMAIN, 'voucher-cleared-accrual.pdf', clearedVoucher.bytes).relativePath,
      saveArtifact(DOMAIN, 'voucher-settlement.json', JSON.stringify({ settlement: settlementDoc, cleared: accrualDoc, journal: je, settlementPdf: pdfSummary(settlementVoucher.pdf), clearedPdf: pdfSummary(clearedVoucher.pdf) }, null, 2)).relativePath,
    ];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/accrual-settlement`, title: 'EXPENSE without payment → ACCRUAL (21-1104, no voucher), VENDOR_SETTLEMENT with WHT 3% PND3 → POSTED (21-3102) and the cleared expense becomes POSTED with paidAt; both vouchers render', documents: ['PAYMENT_VOUCHER', 'VENDOR_SETTLEMENT'], routes: ['POST /api/expense-documents', 'POST /api/expense-documents/:id/post', 'POST /api/expense-documents/settlement', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts, notes: 'The settlement voucher has no item rows: VENDOR_SETTLEMENT carries settlement lines, not expense lines — the renderer prints totals only (current behaviour, unchanged here)' }));
  });

  it('paginates a 60-line voucher without dropping rows, repeats the table header and keeps totals + signatures together on the last page', async () => {
    const lines: LineSpec[] = Array.from({ length: 60 }, (_, index) => ({ category: '53-1201', description: `ทดสอบระบบ รายการที่ ${String(index + 1).padStart(2, '0')} วัสดุสิ้นเปลืองสำนักงานสำหรับสาขาและงานเอกสารประจำเดือน`, quantity: 1, unitPrice: 100 + index, vatPercent: 7 }));
    const expected = documentMoney(lines.map((line) => lineMoney(line)));
    expect(fixed2(expected.subtotal)).toBe('7770.00');
    expect(fixed2(expected.vatAmount)).toBe('543.90');
    expect(fixed2(expected.netPayment)).toBe('8313.90');
    const created = await createExpense(owner, { branchId: world.branches.a.id, documentDate: today, vendorName: `ทดสอบระบบ ซัพพลายเออร์รายใหญ่ ${world.prefix}`, vendorTaxId: VENDOR_TAX_ID.supplier, paymentMethod: 'BANK_TRANSFER', depositAccountCode: KBANK, lines });
    await postDoc(owner, created.id).expect(201);
    const doc = await getDoc(owner, created.id);
    docs.long = doc;
    expect(fixed2(doc.totalAmount)).toBe('8313.90');
    const { bytes, pdf } = await voucherPdf(owner, created.id);
    expectVoucherTypography(pdf);
    expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
    for (let index = 1; index <= 60; index += 1) expect(allText(pdf)).toContain(foldThai(`รายการที่ ${String(index).padStart(2, '0')}`));
    const pagesWithRows = pdf.pages.filter((page) => foldThai(page.text).includes(foldThai('รายการที่ '))).map((page) => page.index);
    for (const index of pagesWithRows) expect(foldThai(pdf.pages[index - 1].text)).toContain(foldThai('ราคาต่อหน่วย'));
    const closing = pageContaining(pdf, 'จำนวนเงินจ่ายสุทธิ (ตัวอักษร)');
    expect(closing).toBe(pdf.pageCount);
    expect(pageContaining(pdf, 'ผู้จัดทำ')).toBe(closing);
    expect(pageContaining(pdf, 'ผู้อนุมัติ')).toBe(closing);
    expect(pageContaining(pdf, 'สแกนเพื่อตรวจสอบ')).toBe(closing);
    expectText(pdf, 'จำนวนเงินจ่ายสุทธิ 8,313.90 บาท', 'แปดพันสามร้อยสิบสามบาทเก้าสิบสตางค์', 'มูลค่าก่อนภาษี 7,770.00', 'ภาษีมูลค่าเพิ่ม 7% 543.90');
    const artifacts = [
      saveArtifact(DOMAIN, 'voucher-60-lines.pdf', bytes).relativePath,
      saveArtifact(DOMAIN, 'voucher-60-lines.pdf.json', JSON.stringify({ ...pdfSummary(pdf), pagesWithRows, closingPage: closing }, null, 2)).relativePath,
    ];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/long-voucher-pagination`, title: '60-line voucher spans several A4 pages, every row present, table header repeated per page, totals/signatures/QR together on the last page', routes: ['POST /api/expense-documents', 'POST /api/expense-documents/:id/post', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts, unverified: ['paper output and margins on a physical printer (DOC-12)'] }));
  });

  it('enforces token, role, branch and company scope on the voucher and detail routes; denials are JSON, unknown ids are 404, drafts are 400', async () => {
    const target = docs.cash!;
    const path = `/expense-documents/${target.id}/voucher.pdf`;
    const forged = h.client({ token: sign({ sub: owner.user.id, role: 'OWNER', aud: 'admin' }, 'not-the-runner-secret') });
    const expired = h.client({ token: sign({ sub: owner.user.id, role: 'OWNER', aud: 'admin' }, process.env.JWT_SECRET!, { expiresIn: -30 }) });
    for (const client of [h.client({ session: null }), forged, expired]) {
      const response = await client.get(path).expect(401);
      expect(response.headers['content-type']).toMatch(/json/);
    }
    const sales = await api(salesA).get(path).expect(403);
    expect(sales.headers['content-type']).toMatch(/json/);
    // Branch scope: a BRANCH_MANAGER of branch B must not read branch A's voucher or detail by guessing the id.
    const otherBranch = await api(branchManagerB).get(path).expect(403);
    expect(otherBranch.headers['content-type']).toMatch(/json/);
    expect(otherBranch.body.message).toContain('สาขาอื่น');
    await api(branchManagerB).get(`/expense-documents/${target.id}`).expect(403);
    await api(branchManagerA).get(path).expect(200).expect('Content-Type', /application\/pdf/);
    await api(branchManagerA).get(`/expense-documents/${target.id}`).expect(200);
    // Company scope (EntityScopeInterceptor): BRANCH_MANAGER may only work in SHOP; ACCOUNTANT in both.
    await api(branchManagerA, 'FINANCE').get(path).expect(403);
    await api(accountant, 'FINANCE').get(path).expect(200);
    await api(accountant, null).get(path).expect(200);
    // Unknown ids: 404 JSON on both routes (the detail route used to answer 500 from Prisma P2025).
    for (const bad of [randomUUID(), 'not-a-document-id']) {
      const voucher = await api(accountant).get(`/expense-documents/${bad}/voucher.pdf`).expect(404);
      expect(voucher.headers['content-type']).toMatch(/json/);
      const detail = await api(accountant).get(`/expense-documents/${bad}`).expect(404);
      expect(detail.headers['content-type']).toMatch(/json/);
      expect(detail.body.message).toContain('ไม่พบเอกสาร');
    }
    const draft = await createExpense(accountant, { branchId: world.branches.a.id, documentDate: today, vendorName: `ทดสอบระบบ ร่างเอกสาร ${world.prefix}`, lines: [{ category: '53-1201', quantity: 1, unitPrice: 10 }] });
    docs.draft = draft;
    const draftResponse = await api(accountant).get(`/expense-documents/${draft.id}/voucher.pdf`).expect(400);
    expect(draftResponse.headers['content-type']).toMatch(/json/);
    expect(draftResponse.body.message).toContain('ไม่สามารถออกใบสำคัญจ่ายได้');
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/voucher-authorization`, title: 'voucher.pdf + detail: no/forged/expired token 401, SALES 403, other-branch BRANCH_MANAGER 403 (defect fixed in DOC-03), wrong company 403, unknown id 404 (detail used to be 500), DRAFT 400 — all JSON, never bytes', routes: ['GET /api/expense-documents/:id/voucher.pdf', 'GET /api/expense-documents/:id'], renderer: 'none', artifacts: [], notes: 'Defects found and fixed in this issue: ExpenseVoucherPdfService had no branch scope (BRANCH_MANAGER could print any branch by id); ExpenseDocumentQueryService.findOne answered 500 (Prisma P2025) for an unknown id' }));
  });

  it('aggregates the daily summary from the documents that belong to the Thai day, branch and status set — including a void reversal', async () => {
    const branchA = world.branches.a.id;
    const remember = (doc: ExpenseDoc, paidInDay: boolean) => dailyDocs.push({ id: doc.id, number: doc.number, type: doc.documentType, total: fixed2(doc.totalAmount), net: doc.netPayment == null ? null : fixed2(doc.netPayment), paymentMethod: doc.paymentMethod, depositAccountCode: doc.depositAccountCode, paidInDay, lines: (doc.expenseDetail?.lines ?? []).map((line) => ({ category: line.category, base: fixed2(line.amountBeforeVat) })) });
    for (let k = 0; k < 38; k += 1) {
      const cash = k % 2 === 0;
      const created = await createExpense(owner, { branchId: branchA, documentDate: summaryDate, vendorName: `ทดสอบระบบ ผู้ขายรายวัน ${k + 1}`, paymentMethod: cash ? 'CASH' : 'BANK_TRANSFER', depositAccountCode: cash ? CASH_DRAWER : KBANK, lines: [{ category: k % 3 === 0 ? '53-1202' : '53-1201', description: `ทดสอบระบบ รายจ่ายรายวัน ${k + 1}`, quantity: 1, unitPrice: 1000 + k * 10, vatPercent: 7 }] });
      await postDoc(owner, created.id).expect(201);
      remember(await getDoc(owner, created.id), true);
    }
    const withWht = await createExpense(owner, { branchId: branchA, documentDate: summaryDate, vendorName: 'ทดสอบระบบ ผู้รับจ้างอบรม', vendorTaxId: VENDOR_TAX_ID.trainer, whtFormType: 'PND3', paymentMethod: 'BANK_TRANSFER', depositAccountCode: KBANK, lines: [{ category: '53-1105', description: 'ทดสอบระบบ อบรมรายวัน', quantity: 1, unitPrice: 5000, vatPercent: 7, whtPercent: 3 }] });
    await postDoc(owner, withWht.id).expect(201);
    remember(await getDoc(owner, withWht.id), true);
    const accrued = await createExpense(owner, { branchId: branchA, documentDate: summaryDate, vendorName: 'ทดสอบระบบ เจ้าหนี้รายวัน', lines: [{ category: '53-1106', description: 'ทดสอบระบบ ตั้งหนี้รายวัน', quantity: 1, unitPrice: 2000 }] });
    await postDoc(owner, accrued.id).expect(201);
    const cleared = (await api(owner).post('/expense-documents/settlement', { branchId: branchA, documentDate: summaryDate, vendorName: 'ทดสอบระบบ เจ้าหนี้รายวัน', depositAccountCode: KBANK, paymentMethod: 'BANK_TRANSFER', lines: [{ clearedDocumentId: accrued.id, amountSettled: 2000 }] }).expect(201)).body.data as ExpenseDoc;
    await postDoc(owner, cleared.id).expect(201);
    remember(await getDoc(owner, accrued.id), false); // paid through the settlement but has no deposit account of its own
    remember(await getDoc(owner, cleared.id), true);
    const petty = (await api(branchManagerA).post('/expense-documents/petty-cash', { branchId: branchA, documentDate: summaryDate, custodianName: 'ทดสอบระบบ ผู้ดูแลเงินสดย่อยรายวัน', depositAccountCode: PETTY_CASH_FLOAT, lines: [{ supplierName: 'ทดสอบระบบ ร้านน้ำแข็ง', category: '53-1106', amount: 300 }, { supplierName: 'ทดสอบระบบ ร้านถ่ายเอกสาร', category: '53-1201', amount: 500, vatPercent: 7, taxInvoiceNo: 'TEST-PC-DAILY' }] }).expect(201)).body.data as ExpenseDoc;
    remember(await getDoc(owner, petty.id), false);
    const toVoid = await createExpense(owner, { branchId: branchA, documentDate: summaryDate, vendorName: 'ทดสอบระบบ รายการที่จะยกเลิก', paymentMethod: 'CASH', depositAccountCode: CASH_DRAWER, lines: [{ category: '53-1201', description: 'ทดสอบระบบ ยกเลิก', quantity: 1, unitPrice: 700 }] });
    await postDoc(owner, toVoid.id).expect(201);
    await api(branchManagerA).post(`/expense-documents/${toVoid.id}/void`, { reasonCode: 'data_entry_error' }).expect(403);
    const missingReason = await api(accountant).post(`/expense-documents/${toVoid.id}/void`, {}).expect(400);
    expect(missingReason.body.message).toContain('เหตุผล');
    await api(accountant).post(`/expense-documents/${toVoid.id}/void`, { reasonCode: 'data_entry_error' }).expect(201);
    const voided = await getDoc(owner, toVoid.id);
    docs.voided = voided;
    expect(voided.status).toBe('VOIDED');
    const original = await journalLines(voided.journalEntryId!);
    const reversal = await h.prisma.journalEntry.findFirst({ where: { referenceType: 'AUTO', referenceId: `${voided.id}:reversal`, deletedAt: null } });
    expect(reversal).not.toBeNull();
    const reversed = await journalLines(reversal!.id);
    expect(reversed.map((line) => ({ accountCode: line.accountCode, debit: line.credit, credit: line.debit }))).toEqual(expect.arrayContaining(original));
    // Outside the summary window: another branch, and the previous Thai day.
    const branchB = await createExpense(owner, { branchId: world.branches.b.id, documentDate: summaryDate, vendorName: 'ทดสอบระบบ สาขาอื่น', paymentMethod: 'CASH', depositAccountCode: CASH_DRAWER, lines: [{ category: '53-1201', quantity: 1, unitPrice: 900 }] });
    await postDoc(owner, branchB.id).expect(201);
    const dayBefore = await createExpense(owner, { branchId: branchA, documentDate: bkkDate(-4), vendorName: 'ทดสอบระบบ วันก่อนหน้า', paymentMethod: 'CASH', depositAccountCode: CASH_DRAWER, lines: [{ category: '53-1201', quantity: 1, unitPrice: 800 }] });
    await postDoc(owner, dayBefore.id).expect(201);

    const expectedByType: Record<string, { count: number; total: string }> = {};
    const expectedByMethod: Record<string, { count: number; total: string }> = {};
    const expectedByCategory: Record<string, { count: number; total: string }> = {};
    const expectedCash: Record<string, { out: string; count: number }> = {};
    let grand = 0;
    const add = (target: Record<string, { count: number; total: string }>, key: string, amount: number, countIt = true) => {
      const bucket = target[key] ?? { count: 0, total: '0.00' };
      if (countIt) bucket.count += 1;
      bucket.total = (Number(bucket.total) + amount).toFixed(2);
      target[key] = bucket;
    };
    for (const doc of dailyDocs) {
      grand += Number(doc.total);
      add(expectedByType, doc.type, Number(doc.total));
      if (doc.paymentMethod) add(expectedByMethod, doc.paymentMethod, Number(doc.net ?? doc.total));
      const seen = new Set<string>();
      for (const line of doc.lines) { add(expectedByCategory, line.category, Number(line.base), !seen.has(line.category)); seen.add(line.category); }
      if (doc.depositAccountCode && doc.paidInDay) {
        const bucket = expectedCash[doc.depositAccountCode] ?? { out: '0.00', count: 0 };
        bucket.out = (Number(bucket.out) + Number(doc.net ?? doc.total)).toFixed(2);
        bucket.count += 1;
        expectedCash[doc.depositAccountCode] = bucket;
      }
    }
    expect(dailyDocs).toHaveLength(42);

    const response = await api(owner).get(`/expense-documents/daily-summary?date=${summaryDate}&branchId=${branchA}`).expect(200);
    const summary = response.body.data as { date: string; branchId: string; branchName: string; documents: Array<{ id: string; number: string; status: string }>; grandTotal: string; byType: typeof expectedByType; byPaymentMethod: typeof expectedByMethod; byCategory: typeof expectedByCategory; cashMovement: typeof expectedCash };
    expect(summary.branchName).toBe(world.branches.a.name);
    expect(summary.documents.map((doc) => doc.id).sort()).toEqual(dailyDocs.map((doc) => doc.id).sort());
    expect(summary.documents.map((doc) => doc.id)).not.toContain(voided.id);
    expect(summary.documents.map((doc) => doc.id)).not.toContain(branchB.id);
    expect(summary.documents.map((doc) => doc.id)).not.toContain(dayBefore.id);
    expect(summary.documents.map((doc) => doc.number)).toEqual([...summary.documents.map((doc) => doc.number)].sort());
    expect(summary.grandTotal).toBe(grand.toFixed(2));
    expect(summary.byType).toEqual(expectedByType);
    expect(summary.byPaymentMethod).toEqual(expectedByMethod);
    expect(summary.byCategory).toEqual(expectedByCategory);
    expect(summary.cashMovement).toEqual(expectedCash);
    // Scope: branch managers are pinned to their branch; cross-branch roles must name one.
    const pinned = await api(branchManagerA).get(`/expense-documents/daily-summary?date=${summaryDate}`).expect(200);
    expect(pinned.body.data.documents).toHaveLength(42);
    await api(branchManagerA).get(`/expense-documents/daily-summary?date=${summaryDate}&branchId=${world.branches.b.id}`).expect(403);
    const otherBranch = await api(branchManagerB).get(`/expense-documents/daily-summary?date=${summaryDate}`).expect(200);
    expect(otherBranch.body.data.documents.map((doc: { id: string }) => doc.id)).toEqual([branchB.id]);
    await api(owner).get(`/expense-documents/daily-summary?date=${summaryDate}`).expect(400);
    await api(salesA).get(`/expense-documents/daily-summary?date=${summaryDate}&branchId=${branchA}`).expect(403);
    const artifact = saveArtifact(DOMAIN, 'daily-summary.json', JSON.stringify({ date: summaryDate, expected: { grandTotal: grand.toFixed(2), byType: expectedByType, byPaymentMethod: expectedByMethod, byCategory: expectedByCategory, cashMovement: expectedCash, documents: dailyDocs.map((doc) => doc.number) }, actual: { ...summary, documents: summary.documents.map((doc) => ({ id: doc.id, number: doc.number, status: doc.status })) } }, null, 2)).relativePath;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/daily-summary-api`, title: '42 documents (cash / bank / WHT / accrual+settlement / petty cash draft) on one Thai day and branch: document set, grand total, by-type, by-method (net), by-category (per line) and cash movement match the independent fixture; VOIDED, other branch and previous day excluded; void posts a mirrored reversal JE', documents: ['DAILY_EXPENSE_SUMMARY', 'PAYMENT_VOUCHER'], routes: ['POST /api/expense-documents', 'POST /api/expense-documents/settlement', 'POST /api/expense-documents/petty-cash', 'POST /api/expense-documents/:id/post', 'POST /api/expense-documents/:id/void', 'GET /api/expense-documents/daily-summary'], renderer: 'none', artifacts: [artifact], notes: 'Current policy observed: DRAFT and ACCRUAL documents are included in the daily summary (status ≠ VOIDED); only documents with a deposit account and paidAt inside the day count as cash movement' }));
  }, 300000);

  it('still prints the voucher of a voided document, stamped with the reversal overlay', async () => {
    const doc = docs.voided!;
    const { bytes, pdf } = await voucherPdf(accountant, doc.id);
    expectVoucherTypography(pdf);
    expectText(pdf, doc.number, 'จำนวนเงินจ่ายสุทธิ 700.00 บาท', 'เจ็ดร้อยบาทถ้วน');
    // The overlay is rotated, so read it from the 64 pt glyph runs instead of baseline rows.
    const overlay = pdf.pages[0].items.filter((item) => Math.round(item.size) === 64).sort((a, b) => a.x - b.x).map((item) => item.str).join('');
    expect(foldThai(overlay)).toContain(foldThai(VOID_OVERLAY));
    const artifact = saveArtifact(DOMAIN, 'voucher-voided.pdf', bytes).relativePath;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/voided-voucher`, title: 'VOIDED voucher renders with the 64 pt "ยกเลิก / กลับรายการแล้ว" overlay; EXPENSE_CANCEL required and a reason code enforced', routes: ['POST /api/expense-documents/:id/void', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts: [artifact] }));
  });

  it('creates a petty cash reimbursement with per-line suppliers and satang, and pins that posting it is not supported by the API today', async () => {
    const input = {
      branchId: world.branches.a.id, documentDate: today, custodianName: `ทดสอบระบบ ผู้ดูแลเงินสดย่อย ${world.prefix}`, depositAccountCode: PETTY_CASH_FLOAT, description: 'ทดสอบระบบ เบิกชดเชยเงินสดย่อยประจำสัปดาห์',
      lines: [
        { supplierName: 'ทดสอบระบบ ร้านกาแฟหน้าปากซอย', category: '53-1106', description: 'กาแฟรับรองลูกค้า', amount: 250.5 },
        { supplierName: 'ทดสอบระบบ ร้านเครื่องเขียน', category: '53-1201', description: 'กระดาษ A4 2 รีม', amount: 1200, vatPercent: 7, taxInvoiceNo: `TEST-PC-${world.prefix}` },
        { supplierName: 'ทดสอบระบบ ไปรษณีย์', category: '53-1203', description: 'อากรแสตมป์', amount: 45.25 },
      ],
    };
    const expected = documentMoney([pettyCashLineMoney(250.5), pettyCashLineMoney(1200, 7), pettyCashLineMoney(45.25)]);
    expect(fixed2(expected.subtotal)).toBe('1495.75');
    expect(fixed2(expected.vatAmount)).toBe('84.00');
    expect(fixed2(expected.totalAmount)).toBe('1579.75');
    await api(branchManagerB).post('/expense-documents/petty-cash', input).expect(403);
    await api(branchManagerA).post('/expense-documents/petty-cash', { ...input, depositAccountCode: KBANK }).expect(400);
    const created = (await api(branchManagerA).post('/expense-documents/petty-cash', input).expect(201)).body.data as ExpenseDoc;
    docs.petty = created;
    expect(created.documentType).toBe('PETTY_CASH_REIMBURSEMENT');
    expect(created.number).toMatch(/^PC-\d{4}-\d{3,}$/);
    expect(created.status).toBe('DRAFT');
    expect(created.paymentMethod).toBe('CASH');
    expect(fixed2(created.subtotal)).toBe('1495.75');
    expect(fixed2(created.vatAmount)).toBe('84.00');
    expect(fixed2(created.totalAmount)).toBe('1579.75');
    expect(fixed2(created.netPayment!)).toBe('1579.75');
    expect(created.expenseDetail!.lines.map((line) => [line.supplierName, line.category, fixed2(line.amountBeforeVat), fixed2(line.vatAmount)])).toEqual([
      ['ทดสอบระบบ ร้านกาแฟหน้าปากซอย', '53-1106', '250.50', '0.00'], ['ทดสอบระบบ ร้านเครื่องเขียน', '53-1201', '1200.00', '84.00'], ['ทดสอบระบบ ไปรษณีย์', '53-1203', '45.25', '0.00'],
    ]);
    const notPosted = await postDoc(owner, created.id).expect(400);
    expect(notPosted.body.message).toContain('PETTY_CASH_REIMBURSEMENT not supported');
    expect((await getDoc(owner, created.id)).status).toBe('DRAFT');
    const noVoucher = await api(owner).get(`/expense-documents/${created.id}/voucher.pdf`).expect(400);
    expect(noVoucher.headers['content-type']).toMatch(/json/);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/petty-cash-create`, title: 'PETTY_CASH_REIMBURSEMENT: V20 float account enforced, per-line suppliers/VAT/satang persisted as the fixture computes; POST :id/post answers 400 "type PETTY_CASH_REIMBURSEMENT not supported" so the sheet exists only as a DRAFT browser print', documents: ['PETTY_CASH_REIMBURSEMENT'], routes: ['POST /api/expense-documents/petty-cash', 'POST /api/expense-documents/:id/post', 'GET /api/expense-documents/:id/voucher.pdf'], renderer: 'none', artifacts: [], status: 'BLOCKED', unverified: ['posting / journal of petty cash (PettyCashTemplate is unreachable from executePostBody — pinned by expense-document-lifecycle-posting.service.spec.ts; product decision for the owner, not changed in DOC-03)'] }));
  });

  describe('browser — the real admin web app through the Vite proxy', () => {
    let context: BrowserContext | null = null;
    // The accountant logs in once and is reused by the voucher page and the detail page tests.
    let accountantSession: { context: BrowserContext; page: Page; errors: string[]; runtime: WebRuntime } | null = null;
    afterEach(async () => { await context?.close().catch(() => undefined); context = null; });
    afterAll(async () => { await accountantSession?.context.close().catch(() => undefined); });

    it('/expenses/:id/voucher prints ต้นฉบับ + สำเนา + the 50 ทวิ certificate on A4, honours voucher_print_mode=single', async () => {
      const doc = docs.cash!;
      accountantSession = await openAs(world.users.accountant, `/expenses/${doc.id}/voucher`);
      const { page, errors } = accountantSession;
      await waitForText(page, 'PAYMENT VOUCHER · ต้นฉบับ', 'voucher-page');
      await page.waitForFunction(() => document.querySelectorAll('article.voucher-sheet').length === 3, undefined, { timeout: 30_000 });
      const sheets = await page.locator('article.voucher-sheet').allInnerTexts();
      expect(sheets[0]).toContain('PAYMENT VOUCHER · ต้นฉบับ');
      expect(sheets[1]).toContain('PAYMENT VOUCHER · สำเนา');
      expect(sheets[2]).toContain('ใบรับรองการหักภาษี ณ ที่จ่าย');
      for (const sheet of sheets.slice(0, 2)) {
        expect(sheet).toContain(doc.number);
        expect(sheet).toContain(thaiLongDate(today));
        expect(sheet).toContain(doc.vendorName!);
        expect(sheet).toContain(VENDOR_TAX_ID.juristic);
        expect(sheet).toContain('สองหมื่นห้าร้อยเจ็ดสิบห้าบาทถ้วน');
        for (const label of ['(ผู้จัดทำ)', '(ผู้อนุมัติ)', '(ผู้รับเงิน)', '(ตราประทับ)']) expect(sheet).toContain(label);
        for (const amount of ['2,500.00', '11,500.00', '6,000.00', '20,000.00', '980.00', '20,980.00', '405.00', '20,575.00']) expect(sheet).toContain(amount);
      }
      const certificate = sheets[2];
      expect(certificate).toContain('ภ.ง.ด. 53');
      expect(certificate).toContain('อัตรา 3.00%');
      expect(certificate).toContain('อัตรา 1.00%');
      expect(certificate).toContain('11,500.00');
      expect(certificate).toContain('345.00');
      expect(certificate).toContain('60.00');
      expect(certificate).toContain('สี่ร้อยห้าบาทถ้วน');
      expect(certificate).toContain(doc.vendorName!);
      expect(certificate).toContain('(ผู้จ่ายเงิน / ผู้มีหน้าที่หักภาษี)');
      const screenshots = await shots(page, 'voucher-page');
      const printed = await printToPdf(page, 'voucher-page-print-multi');
      const pdf = printed.pdf;
      expect(pdf.pageCount).toBeGreaterThanOrEqual(3);
      expect(pdf.pages.every(isA4)).toBe(true);
      expect(pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
      expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
      const originalPage = pageContaining(pdf, 'PAYMENT VOUCHER · ต้นฉบับ');
      const copyPage = pageContaining(pdf, 'PAYMENT VOUCHER · สำเนา');
      const certificatePage = pageContaining(pdf, 'ใบรับรองการหักภาษี ณ ที่จ่าย');
      expect(originalPage).toBe(1);
      expect(copyPage).toBeGreaterThan(originalPage);
      expect(certificatePage).toBeGreaterThan(copyPage);
      expect(pageContaining(pdf, 'ยอดสุทธิที่จ่าย')).toBe(pageContaining(pdf, '(ตราประทับ)'));
      expect(foldThai(pdf.pages[originalPage - 1].text)).toContain(foldThai('ยอดสุทธิที่จ่าย'));
      expect(foldThai(pdf.pages[originalPage - 1].text)).toContain(foldThai('(ตราประทับ)'));
      expect(allText(pdf)).toContain(foldThai('สองหมื่นห้าร้อยเจ็ดสิบห้าบาทถ้วน'));
      expect(allText(pdf)).not.toContain(foldThai('พิมพ์ / Save PDF'));
      const artifacts = [...screenshots, printed.printMediaShot, printed.artifact, saveArtifact(DOMAIN, 'voucher-page-print-multi.pdf.json', JSON.stringify({ ...pdfSummary(pdf), variant: printed.variant, fontLoaded: printed.fontLoaded, tried: printed.tried, originalPage, copyPage, certificatePage, consoleErrors: errors }, null, 2)).relativePath];

      // voucher_print_mode=single → the copy disappears. ui-flags are cached by React Query, so this is the one full reload (POST /auth/refresh) of the file.
      await setSystemConfig(h.prisma, 'voucher_print_mode_default', 'single');
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForText(page, 'PAYMENT VOUCHER · ต้นฉบับ', 'voucher-page-single');
        await page.waitForFunction(() => document.querySelectorAll('article.voucher-sheet').length === 2, undefined, { timeout: 30_000 });
        const single = await page.locator('article.voucher-sheet').allInnerTexts();
        expect(single[0]).toContain('PAYMENT VOUCHER · ต้นฉบับ');
        expect(single[1]).toContain('ใบรับรองการหักภาษี ณ ที่จ่าย');
        const singlePrinted = await printToPdf(page, 'voucher-page-print-single');
        expect(pageContaining(singlePrinted.pdf, 'PAYMENT VOUCHER · สำเนา')).toBe(0);
        expect(pageContaining(singlePrinted.pdf, 'ใบรับรองการหักภาษี ณ ที่จ่าย')).toBeGreaterThan(0);
        artifacts.push(singlePrinted.artifact);
      } finally {
        await clearSystemConfig(h.prisma, 'voucher_print_mode_default');
      }
      expect(pageErrors(errors)).toEqual([]);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-voucher-print`, title: 'Real web app: PaymentVoucherPage renders original + copy + 50 ทวิ certificate (two WHT rates, ภ.ง.ด. 53) from GET /expense-documents/:id; print-media PDF is A4 in TH Sarabun PSK 16 pt with totals and signatures on the same page; voucher_print_mode=single drops the copy', routes: ['POST /api/auth/login', 'GET /api/expense-documents/:id', 'GET /api/settings/ui-flags', 'GET /api/company-info'], artifacts, notes: `Browser print entry = Chromium print-media page.pdf (${printed.variant}) of the real page — window.print() cannot be captured; screenshots at 1440 and 390; ${consoleNote(errors)}` }));
    }, 300000);

    it('the petty cash sheet prints without a signature grid, with per-line suppliers and the satang amount in words', async () => {
      const doc = docs.petty!;
      const opened = await openAs(world.users.branchManagerA, `/expenses/${doc.id}/voucher`);
      context = opened.context;
      const { page, errors } = opened;
      await waitForText(page, 'PETTY CASH REIMBURSEMENT', 'petty-cash-page');
      expect(await page.locator('article.voucher-sheet').count()).toBe(1);
      expect(await page.title()).toBe(`ใบเบิกชดเชยเงินสดย่อย ${doc.number}`);
      const sheet = (await page.locator('article.voucher-sheet').allInnerTexts())[0];
      expect(sheet).toContain('ใบเบิกชดเชยเงินสดย่อย');
      expect(sheet).toContain(doc.number);
      expect(sheet).toContain(thaiLongDate(today));
      expect(sheet).toContain(`ทดสอบระบบ ผู้ดูแลเงินสดย่อย ${world.prefix}`);
      expect(sheet).toContain(PETTY_CASH_FLOAT);
      expect(sheet).toContain('3 ราย · 3 รายการ');
      for (const supplier of ['ทดสอบระบบ ร้านกาแฟหน้าปากซอย', 'ทดสอบระบบ ร้านเครื่องเขียน', 'ทดสอบระบบ ไปรษณีย์']) expect(sheet).toContain(supplier);
      for (const amount of ['250.50', '1,200.00', '84.00', '1,284.00', '45.25', '1,495.75', '1,579.75']) expect(sheet).toContain(amount);
      expect(sheet).toContain('หนึ่งพันห้าร้อยเจ็ดสิบเก้าบาทเจ็ดสิบห้าสตางค์');
      for (const label of ['(ผู้จัดทำ)', '(ผู้อนุมัติ)', '(ผู้รับเงิน)', '(ตราประทับ)', 'หัก ณ ที่จ่าย', 'ใบรับรองการหักภาษี']) expect(sheet).not.toContain(label);
      const screenshots = await shots(page, 'petty-cash-page');
      const printed = await printToPdf(page, 'petty-cash-page-print');
      const pdf = printed.pdf;
      expect(pdf.pageCount).toBe(1);
      expect(pdf.pages.every(isA4)).toBe(true);
      expect(pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
      expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
      expect(sizesOfText(pdf, 'ใบเบิกชดเชยเงินสดย่อย')).toContain(DOCUMENT_STYLE.headingPt);
      expectText(pdf, doc.number, 'หนึ่งพันห้าร้อยเจ็ดสิบเก้าบาทเจ็ดสิบห้าสตางค์', '1,579.75');
      expect(allText(pdf)).not.toContain(foldThai('(ผู้จัดทำ)'));
      expect(pageErrors(errors)).toEqual([]);
      const artifacts = [...screenshots, printed.printMediaShot, printed.artifact, saveArtifact(DOMAIN, 'petty-cash-page-print.pdf.json', JSON.stringify({ ...pdfSummary(pdf), variant: printed.variant, fontLoaded: printed.fontLoaded, tried: printed.tried, consoleErrors: errors }, null, 2)).relativePath];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-petty-cash-sheet`, title: 'Real web app: petty cash sheet keeps the no-signature policy, one page A4, per-line suppliers/VAT, satang amount in words', documents: ['PETTY_CASH_REIMBURSEMENT'], routes: ['POST /api/auth/login', 'GET /api/expense-documents/:id'], artifacts, notes: consoleNote(errors) }));
    }, 300000);

    it('the detail page "พิมพ์ใบสำคัญจ่าย" preview fetches the same voucher route with the real JWT and company scope', async () => {
      const doc = docs.cash!;
      expect(accountantSession).not.toBeNull();
      const { page, errors, runtime } = accountantSession!;
      errors.length = 0;
      await runtime.navigate(page, `/expenses/${doc.id}`);
      const button = page.getByRole('button', { name: 'พิมพ์ใบสำคัญจ่าย' });
      await button.waitFor({ state: 'visible', timeout: 60_000 });
      const [response] = await Promise.all([
        page.waitForResponse((candidate) => candidate.url().includes(`/expense-documents/${doc.id}/voucher.pdf`), { timeout: 60_000 }),
        button.click(),
      ]);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toMatch(/application\/pdf/);
      expect(['shop', 'finance']).toContain(new URL(response.url()).searchParams.get('company'));
      expect(response.request().headers()['authorization']).toMatch(/^Bearer /);
      const fromBrowser = await parsePdf(await response.body());
      const fromApi = (await voucherPdf(accountant, doc.id)).pdf;
      expect(contentSignature(fromBrowser)).toBe(contentSignature(fromApi));
      await page.locator('iframe[title$=".pdf"]').waitFor({ state: 'visible', timeout: 30_000 });
      const download = page.locator('a[download]');
      expect(await download.getAttribute('download')).toBe(`${doc.number}.pdf`);
      const screenshot = saveArtifact(DOMAIN, 'detail-page-preview-1440.png', await page.screenshot({ fullPage: true })).relativePath;
      expect(pageErrors(errors)).toEqual([]);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-detail-preview`, title: 'ExpenseDetailPage → PdfPreview requests GET /expense-documents/:id/voucher.pdf with Bearer token + ?company=; the bytes the browser received carry the same content signature as the API download', routes: ['POST /api/auth/login', 'GET /api/expense-documents/:id', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts: [screenshot], notes: consoleNote(errors) }));
    }, 300000);

    it('the daily summary prints every document of the day over several A4 pages with the grand total and signature block together', async () => {
      const opened = await openAs(world.users.owner, `/expenses/daily-summary?date=${summaryDate}&branchId=${world.branches.a.id}`);
      context = opened.context;
      const { page, errors } = opened;
      await waitForText(page, 'รายการเอกสาร (42 รายการ)', 'daily-summary-page');
      const sheet = (await page.locator('.bc-daily-sheet').allInnerTexts())[0];
      expect(sheet).toContain('ใบสรุปรายจ่ายประจำวัน');
      expect(sheet).toContain(thaiLongDate(summaryDate));
      expect(sheet).toContain(`สาขา ${world.branches.a.name}`);
      for (const doc of dailyDocs) expect(sheet).toContain(doc.number);
      const grand = dailyDocs.reduce((sum, doc) => sum + Number(doc.total), 0);
      expect(sheet).toContain('รวมทั้งสิ้น');
      expect(sheet).toContain(`${money(grand)} บาท`);
      // Every row carries a Thai type label and its account codes (defects fixed in DOC-03: raw enum for petty cash, "-" for every account).
      expect(sheet).toContain('ใบเบิกชดเชยเงินสดย่อย (PC)');
      expect(sheet).not.toContain('PETTY_CASH_REIMBURSEMENT');
      expect(sheet).toContain('53-1106, 53-1201');
      expect(sheet).toContain('53-1105');
      expect(sheet).toContain('53-1202');
      const settlementRows = dailyDocs.filter((doc) => doc.type === 'VENDOR_SETTLEMENT').length;
      expect((sheet.match(/\t-\t/g) ?? []).length).toBe(settlementRows);
      const screenshots = await shots(page, 'daily-summary-page');
      const printed = await printToPdf(page, 'daily-summary-print');
      const pdf = printed.pdf;
      expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
      expect(pdf.pages.every(isA4)).toBe(true);
      expect(pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
      expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
      // Cells wrap inside the narrow print columns, so identifiers are checked in paint order (a cell's lines stay contiguous).
      expectStream(pdf, ...dailyDocs.map((doc) => doc.number), 'ใบเบิกชดเชยเงินสดย่อย (PC)', '53-1106, 53-1201', 'จ่ายเจ้าหนี้ (SE)', '53-1105', '53-1202');
      expect(streamText(pdf)).not.toContain('PETTY_CASH_REIMBURSEMENT');
      expect(streamText(pdf)).not.toContain(foldThai('เข้าสู่ระบบสำเร็จ'));
      expect(pageContaining(pdf, 'ใบสรุปรายจ่ายประจำวัน')).toBe(1);
      const grandPage = pageContaining(pdf, `รวมทั้งสิ้น ${money(grand)} บาท`);
      expect(grandPage).toBe(pdf.pageCount);
      expect(pageContaining(pdf, 'ผู้ตรวจสอบ')).toBe(grandPage);
      expect(allText(pdf)).not.toContain(foldThai('เลือกสาขา'));
      expect(pageErrors(errors)).toEqual([]);
      const artifacts = [...screenshots, printed.printMediaShot, printed.artifact, saveArtifact(DOMAIN, 'daily-summary-print.pdf.json', JSON.stringify({ ...pdfSummary(pdf), variant: printed.variant, fontLoaded: printed.fontLoaded, tried: printed.tried, grandPage, documents: dailyDocs.length, consoleErrors: errors }, null, 2)).relativePath];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-daily-summary-print`, title: 'Real web app: ExpenseDailySummaryPage lists all 42 documents from GET /expense-documents/daily-summary; print-media PDF spans ≥2 A4 pages in TH Sarabun PSK with nothing dropped and the grand total + signature block on the last page', documents: ['DAILY_EXPENSE_SUMMARY'], routes: ['POST /api/auth/login', 'GET /api/expense-documents/daily-summary', 'GET /api/branches'], artifacts, unverified: ['Excel export (client-side ExcelJS) not exercised here'], notes: consoleNote(errors) }));
    }, 300000);

    it('the print entry shows a recoverable error for a wrong id and for another branch’s document', async () => {
      const opened = await openAs(branchManagerBUser, `/expenses/${randomUUID()}/voucher`);
      context = opened.context;
      const { page, errors, runtime } = opened;
      const alert = page.getByRole('alert');
      await alert.waitFor({ state: 'visible', timeout: 60_000 });
      const unknownText = await alert.innerText();
      expect(unknownText).toContain('ไม่สามารถโหลดข้อมูลได้');
      await page.getByRole('button', { name: 'ลองใหม่' }).click();
      await alert.waitFor({ state: 'visible', timeout: 30_000 });
      expect(await page.locator('article.voucher-sheet').count()).toBe(0);
      const unknownShot = saveArtifact(DOMAIN, 'print-entry-unknown-id.png', await page.screenshot({ fullPage: true })).relativePath;

      await runtime.navigate(page, `/expenses/${docs.cash!.id}/voucher`);
      await alert.waitFor({ state: 'visible', timeout: 60_000 });
      const foreignText = await alert.innerText();
      expect(foreignText).toContain('ไม่สามารถโหลดข้อมูลได้');
      expect(await page.locator('article.voucher-sheet').count()).toBe(0);
      expect(await page.content()).not.toContain(docs.cash!.number);
      const foreignShot = saveArtifact(DOMAIN, 'print-entry-other-branch.png', await page.screenshot({ fullPage: true })).relativePath;
      expect(pageErrors(errors)).toEqual([]);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-print-entry-errors`, title: 'PaymentVoucherPage: unknown id (404) and other-branch document (403, BRANCH_MANAGER B) both show the QueryBoundary error with a working retry, never a sheet or the document number', routes: ['POST /api/auth/login', 'GET /api/expense-documents/:id'], renderer: 'none', artifacts: [unknownShot, foreignShot], notes: `messages: unknown="${unknownText.replace(/\s+/g, ' ').trim()}" foreign="${foreignText.replace(/\s+/g, ' ').trim()}"; ${consoleNote(errors)}` }));
    }, 300000);
  });

  it('never called an outbound transport during the whole flow', () => {
    expect(h.external.calls).toEqual([]);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: 'LINE/SMS/e-mail recorder stayed empty for the entire scenario file (approval requests only produced IN_APP notifications)', routes: [], renderer: 'none', artifacts: [] }));
  });
});
