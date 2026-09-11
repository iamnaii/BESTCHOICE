import { join } from 'path';
import type { BrowserContext, Page } from '@playwright/test';
import request from 'supertest';
import { DOCUMENT_STYLE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { bangkokDate, expectedExpenseTotals, ExpenseLineSpec, expectedPettyCashTotals } from './support/expense-fixtures';
import { downloadBytes, startWeb, WebRuntime } from './support/web';
import { recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { contentSignature, foldThai, isA4, pageContaining, pageText, parsePdf, ParsedPdf } from './support/pdf';

/**
 * DOC-03 browser evidence (issue #1562): the real admin web app against this
 * run's API — the expense detail page (PdfPreview of the server voucher), the
 * browser-print voucher page (/expenses/:id/voucher: ต้นฉบับ + สำเนา + attached
 * ภ.ง.ด. certificate, petty-cash sheet without signatures) and the daily expense
 * summary sheet, captured as PDFs through Chromium's print pipeline.
 */
const DOMAIN = 'expenses-browser';
const GUARDS = ['real login form → POST /api/auth/login', 'JwtAuthGuard', 'RolesGuard', 'BranchGuard', 'findOne branch scope', 'EntityScopeInterceptor (?company= from the sidebar work selection)'];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded, never sent',
  'private local storage instead of GCS/S3',
  'documents created and posted through the API before the browser starts; synthetic company/branches/users',
  'browser-print pages captured with Playwright page.pdf() (Chromium print pipeline, A4) — not a physical printer or the native print dialog (DOC-12)',
  'web served by the Vite dev server (same source as the production bundle); in-app routing after one real login per viewport',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['PAYMENT_VOUCHER'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});
type ExpenseDoc = { id: string; number: string; status: string; documentType: string; totalAmount: string; withholdingTax: string };
const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
const fmt = (value: string | number) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe('DOC-03 browser evidence — expense voucher preview, browser-print voucher and daily summary', () => {
  let h: DocumentsHarness;
  let web: WebRuntime;
  let world: DocumentsWorld;
  let owner: Session;
  let voucher: ExpenseDoc;
  let petty: ExpenseDoc;
  const summaryDocs: ExpenseDoc[] = [];
  let apiSignature: string;
  const today = bangkokDate(0);
  const whtLines: ExpenseLineSpec[] = [
    { category: '53-1201', description: 'กระดาษ A4 ทดสอบระบบ', quantity: 10, unitPrice: 120, vatPercent: 7, whtPercent: 3 },
    { category: '53-1302', description: 'ค่าไฟฟ้าสำนักงาน ทดสอบระบบ', quantity: 1, unitPrice: 2500, vatPercent: 7, whtPercent: 1 },
  ];
  const whtExpected = expectedExpenseTotals(whtLines);
  const pettyLines = [
    { supplierName: 'ทดสอบระบบ ร้านเครื่องเขียน', category: '53-1201', description: 'ปากกาและแฟ้ม', amount: 350 },
    { supplierName: 'ทดสอบระบบ ร้านอาหาร', category: '53-1106', description: 'อาหารกลางวันประชุม', amount: 420 },
  ];
  const pettyExpected = expectedPettyCashTotals(pettyLines);

  const ok = async (test: request.Test, status = 201, label = 'request'): Promise<request.Response> => {
    const response = await test;
    if (response.status !== status) throw new Error(`${label} → ${response.status} (expected ${status}) ${JSON.stringify(response.body)}`);
    return response;
  };
  const load = async (id: string): Promise<ExpenseDoc> => {
    const row = await h.prisma.expenseDocument.findUniqueOrThrow({ where: { id } });
    return { id: row.id, number: row.number, status: row.status, documentType: row.documentType, totalAmount: row.totalAmount.toString(), withholdingTax: row.withholdingTax.toString() };
  };
  const createAndPost = async (body: Record<string, unknown>, path = '/expense-documents') => {
    const created = await ok(h.client({ session: owner, company: 'FINANCE' }).post(path, body), 201, `POST ${path}`);
    const id = (created.body.data as { id: string }).id;
    await ok(h.client({ session: owner, company: 'FINANCE' }).post(`/expense-documents/${id}/post`), 201, 'post');
    return load(id);
  };
  const apiPdf = async (id: string) => bodyBuffer(await h.client({ session: owner, company: 'FINANCE' }).get(`/expense-documents/${id}/voucher.pdf`).expect(200));
  const has = (pdf: ParsedPdf, needle: string) => foldThai(pdf.pages.map(pageText).join('\n')).includes(foldThai(needle));
  const expectAll = (pdf: ParsedPdf, needles: string[]) => { for (const needle of needles) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: true }); };
  const expectNone = (pdf: ParsedPdf, needles: string[]) => { for (const needle of needles) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: false }); };
  const shot = async (page: Page, name: string) => saveArtifact(DOMAIN, name, await page.screenshot({ fullPage: true })).relativePath;
  const consoleNote = (errors: string[]) => (errors.length ? `console errors: ${errors.join(' | ').slice(0, 500)}` : 'no console errors');
  /** Let transient UI (login toast) leave before evidence is captured; a fixed-position toast would otherwise print on every page. */
  const settle = async (page: Page) => { await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined); };
  /**
   * Chromium print pipeline of the current page (what window.print() hands to the printer).
   * Print media must be applied and painted for at least one frame before printToPDF:
   * the print stylesheet switches every element to TH Sarabun PSK, and a PDF requested in
   * the same frame as that switch comes back with layout but no text at all (observed
   * 4/4 with Playwright chromium; 10/10 correct with the two-frame wait).
   */
  const printToPdf = async (page: Page): Promise<{ bytes: Buffer; beforePrintFired: boolean }> => {
    await page.waitForFunction(() => document.fonts.status === 'loaded', undefined, { timeout: 30_000 });
    await page.evaluate(() => {
      const w = window as unknown as { __bcBeforePrint?: number };
      if (w.__bcBeforePrint === undefined) { w.__bcBeforePrint = 0; window.addEventListener('beforeprint', () => { w.__bcBeforePrint! += 1; }); }
    });
    const before = await page.evaluate(() => (window as unknown as { __bcBeforePrint: number }).__bcBeforePrint);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const bytes = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
    await page.emulateMedia({ media: 'screen' });
    const after = await page.evaluate(() => (window as unknown as { __bcBeforePrint: number }).__bcBeforePrint);
    return { bytes, beforePrintFired: after > before };
  };
  const waitForText = async (page: Page, text: string, label: string) => {
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ timeout: 45_000 });
    } catch (error) {
      await page.screenshot({ path: join(process.env.DOCS_QA_OUTPUT!, DOMAIN, `failure-${label}.png`), fullPage: true }).catch(() => undefined);
      const body = await page.locator('body').innerText().catch(() => '');
      saveArtifact(DOMAIN, `failure-${label}.txt`, `${page.url()}\n\n${body.slice(0, 4000)}`);
      throw new Error(`${label}: "${text}" not visible at ${page.url()} — ${String((error as Error).message).split('\n')[0]}`);
    }
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    owner = await h.login(world.users.owner.email, world.password);
    const base = { documentType: 'EXPENSE', branchId: world.branches.a.id, documentDate: today, priceType: 'EXCLUSIVE', paymentMethod: 'CASH', depositAccountCode: '11-1101' };
    voucher = await createAndPost({ ...base, vendorName: 'ทดสอบระบบ ผู้ขาย จำกัด', vendorTaxId: '0000000000000', whtFormType: 'PND53', lines: whtLines });
    apiSignature = contentSignature(await parsePdf(await apiPdf(voucher.id)));
    petty = await createAndPost({ branchId: world.branches.a.id, documentDate: today, depositAccountCode: '11-1103', custodianName: 'ทดสอบระบบ ผู้ดูแลเงินสดย่อย', lines: pettyLines }, '/expense-documents/petty-cash');
    for (let i = 0; i < 22; i += 1) {
      summaryDocs.push(await createAndPost({ ...base, vendorName: `ทดสอบระบบ ผู้ขายรายวัน ${i + 1}`, lines: [{ category: i % 3 === 0 ? '53-1201' : i % 3 === 1 ? '53-1301' : '53-1303', description: `รายจ่ายรายวัน ${i + 1}`, quantity: 1, unitPrice: 100 + i }] }));
    }
    web = await startWeb(h);
  }, 300000);

  afterAll(async () => {
    await web?.close();
    await h?.close();
  });

  for (const viewport of VIEWPORTS) {
    const w = viewport.width;
    describe(`${w}px`, () => {
      let context: BrowserContext;
      let page: Page;
      let errors: string[];
      beforeAll(async () => {
        ({ context, page, errors } = await web.page(viewport));
        await web.login(page, world.users.owner.email, world.password);
      }, 120000);
      afterAll(async () => { await context?.close(); });

      it('expense detail page: print opens the PdfPreview of the server voucher and "ดาวน์โหลด PDF" saves the same bytes the API renders', async () => {
        await web.navigate(page, `/expenses/${voucher.id}`);
        await waitForText(page, voucher.number, `detail-${w}`);
        const printButton = page.getByRole('button', { name: /พิมพ์/ }).first();
        await printButton.waitFor({ timeout: 45_000 });
        const shotDetail = await shot(page, `expense-detail-${w}.png`);
        await printButton.click();
        const link = page.getByRole('link', { name: 'ดาวน์โหลด PDF' });
        await link.waitFor({ timeout: 60_000 });
        const shotPreview = await shot(page, `expense-pdf-preview-${w}.png`);
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), link.click()]);
        expect(download.suggestedFilename()).toBe(`${voucher.number}.pdf`);
        const bytes = await downloadBytes(download);
        expect(contentSignature(await parsePdf(bytes))).toBe(apiSignature);
        await page.getByRole('button', { name: 'ปิดตัวอย่าง' }).click();
        expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
        recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/detail-preview-${w}`, title: `${w}px /expenses/:id → พิมพ์ → PdfPreview (GET voucher.pdf) → ดาวน์โหลด PDF saves ${voucher.number}.pdf with the API content`, routes: ['GET /api/expense-documents/:id', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts: [shotDetail, shotPreview, saveArtifact(DOMAIN, `expense-preview-download-${w}.pdf`, bytes).relativePath], notes: consoleNote(errors) }));
      });

      it('daily summary sheet: browser print of /expenses/daily-summary spans more than one A4 page without dropping documents', async () => {
        await web.navigate(page, `/expenses/daily-summary?date=${today}&branchId=${world.branches.a.id}`);
        await waitForText(page, 'ใบสรุปรายจ่ายประจำวัน', `summary-${w}`);
        await waitForText(page, summaryDocs[summaryDocs.length - 1].number, `summary-rows-${w}`);
        await settle(page);
        const shotSummary = await shot(page, `daily-summary-${w}.png`);
        const api = (await h.client({ session: owner, company: 'FINANCE' }).get('/expense-documents/daily-summary').query({ date: today, branchId: world.branches.a.id }).expect(200)).body.data as { grandTotal: string; branchName?: string; documents: Array<{ number: string }>; byCategory: Record<string, { total: string }> };
        const { bytes, beforePrintFired } = await printToPdf(page);
        const pdf = await parsePdf(bytes);
        const artifacts = [shotSummary, saveArtifact(DOMAIN, `daily-summary-print-${w}.pdf`, bytes).relativePath, saveArtifact(DOMAIN, `daily-summary-print-${w}.pdf.json`, JSON.stringify({ pageCount: pdf.pageCount, fonts: pdf.fonts, beforePrintFired, grandTotal: api.grandTotal, documents: api.documents.length, lines: pdf.pages.map((p) => p.lines) }, null, 2)).relativePath];
        expect(pdf.pages.every(isA4)).toBe(true);
        expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
        expect(pdf.fonts.length).toBeGreaterThan(0);
        expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
        expectAll(pdf, ['ใบสรุปรายจ่ายประจำวัน', 'DAILY EXPENSE SUMMARY', 'รวมทั้งสิ้น', fmt(api.grandTotal), 'รวมตามหมวดบัญชี', 'รวมตามประเภท', api.branchName ?? world.branches.a.name]);
        for (const doc of api.documents) expect({ number: doc.number, found: has(pdf, doc.number) }).toEqual({ number: doc.number, found: true });
        for (const [code, bucket] of Object.entries(api.byCategory)) expectAll(pdf, [code, fmt(bucket.total)]);
        expect(api.documents.length).toBe(summaryDocs.length + 2);
        expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
        recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/daily-summary-${w}`, title: `${w}px daily summary (${api.documents.length} documents): print pipeline yields ${pdf.pageCount} A4 pages, every document number, category totals and รวมทั้งสิ้น = API grandTotal`, documents: ['EXPENSE_DAILY_SUMMARY'], routes: ['GET /api/expense-documents/daily-summary', 'GET /api/branches'], artifacts, notes: `${consoleNote(errors)}; beforeprint (fitPaperSpacing) fired in the print pipeline: ${beforePrintFired}` }));
      });
    });
  }

  it('browser-print voucher page: ต้นฉบับ + สำเนา + attached ภ.ง.ด.53 certificate with the same amounts; petty cash sheet has no signature grid', async () => {
    const { context, page, errors } = await web.page(VIEWPORTS[0]);
    try {
      await web.login(page, world.users.owner.email, world.password);
      await web.navigate(page, `/expenses/${voucher.id}/voucher`);
      await waitForText(page, voucher.number, 'print-voucher');
      await page.getByText('ใบรับรองการหักภาษี ณ ที่จ่าย').first().waitFor({ timeout: 45_000 });
      await settle(page);
      const shotVoucher = await shot(page, 'print-voucher-1440.png');
      const { bytes, beforePrintFired } = await printToPdf(page);
      const voucherPdfArtifact = saveArtifact(DOMAIN, 'print-voucher-1440.pdf', bytes).relativePath;
      const pdf = await parsePdf(bytes);
      saveArtifact(DOMAIN, 'print-voucher-1440.pdf.json', JSON.stringify({ pageCount: pdf.pageCount, fonts: pdf.fonts, beforePrintFired, lines: pdf.pages.map((p) => p.lines) }, null, 2));
      expect(pdf.pages.every(isA4)).toBe(true);
      expect(pdf.fonts.length).toBeGreaterThan(0);
      expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
      expect(pdf.pageCount).toBe(3);
      expect(pageContaining(pdf, 'PAYMENT VOUCHER · ต้นฉบับ')).toBe(1);
      expect(pageContaining(pdf, 'PAYMENT VOUCHER · สำเนา')).toBe(2);
      expect(pageContaining(pdf, 'ใบรับรองการหักภาษี ณ ที่จ่าย')).toBe(3);
      expectAll(pdf, [voucher.number, 'ทดสอบระบบ ผู้ขาย จำกัด', 'ภ.ง.ด. 53', 'ตามมาตรา 50 ทวิ', fmt(whtExpected.subtotal), fmt(whtExpected.wht), fmt(whtExpected.net), 'ผู้จัดทำ', 'ผู้อนุมัติ', 'ผู้รับเงิน', 'ผู้จ่ายเงิน / ผู้มีหน้าที่หักภาษี']);
      for (const index of [1, 2]) {
        const copy = pdf.pages[index - 1];
        expect(foldThai(pageText(copy))).toContain(foldThai('ยอดสุทธิที่จ่าย'));
        expect(foldThai(pageText(copy))).toContain(foldThai('ผู้อนุมัติ'));
      }

      await web.navigate(page, `/expenses/${petty.id}/voucher`);
      await waitForText(page, petty.number, 'print-petty');
      await page.getByText('ใบเบิกชดเชยเงินสดย่อย').first().waitFor({ timeout: 45_000 });
      const shotPetty = await shot(page, 'print-petty-cash-1440.png');
      const { bytes: pettyBytes } = await printToPdf(page);
      const pettyPdfArtifact = saveArtifact(DOMAIN, 'print-petty-cash-1440.pdf', pettyBytes).relativePath;
      const pettyPdf = await parsePdf(pettyBytes);
      saveArtifact(DOMAIN, 'print-petty-cash-1440.pdf.json', JSON.stringify({ pageCount: pettyPdf.pageCount, fonts: pettyPdf.fonts, lines: pettyPdf.pages.map((p) => p.lines) }, null, 2));
      expect(pettyPdf.pageCount).toBe(1);
      expect(pettyPdf.pages.every(isA4)).toBe(true);
      expectAll(pettyPdf, ['ใบเบิกชดเชยเงินสดย่อย', 'PETTY CASH REIMBURSEMENT', petty.number, 'ผู้ดูแลเงินสดย่อย', 'ทดสอบระบบ ร้านเครื่องเขียน', 'ทดสอบระบบ ร้านอาหาร', fmt(pettyExpected.total)]);
      expectNone(pettyPdf, ['ผู้อนุมัติ', 'ผู้จ่ายเงิน / ผู้มีหน้าที่หักภาษี', 'ใบรับรองการหักภาษี']);

      const serverPetty = await parsePdf(await apiPdf(petty.id));
      expectNone(serverPetty, ['ผู้อนุมัติ', 'ผู้รับเงิน', 'หัก ณ ที่จ่าย']);
      expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/print-page`, title: '/expenses/:id/voucher (window.print entry): 3 pages = ต้นฉบับ, สำเนา, ภ.ง.ด.53 certificate with matching amounts; petty cash sheet = 1 page, no signature grid — same policy the server voucher now follows', documents: ['PAYMENT_VOUCHER', 'WHT_CERTIFICATE', 'PETTY_CASH_VOUCHER'], routes: ['GET /api/expense-documents/:id', 'GET /api/settings/ui-flags'], artifacts: [shotVoucher, voucherPdfArtifact, shotPetty, pettyPdfArtifact], unverified: ['native print dialog and paper output (DOC-12)'], notes: `voucherPrintMode default = multi (2 copies); beforeprint (fitPaperSpacing) fired in the print pipeline: ${beforePrintFired}. ${consoleNote(errors)}. Observation: the route /expenses/:id/voucher is reachable only by URL — no menu or button links to it (server PdfPreview is what the detail page uses)` }));
    } finally {
      await context.close();
    }
  });

  it('PdfPreview: a failed voucher request shows "เปิด PDF ไม่สำเร็จ" with ลองใหม่, and the retry loads the document', async () => {
    const { context, page } = await web.page(VIEWPORTS[0]);
    try {
      await web.login(page, world.users.owner.email, world.password);
      await web.navigate(page, `/expenses/${voucher.id}`);
      await waitForText(page, voucher.number, 'preview-retry');
      await page.route('**/expense-documents/*/voucher.pdf*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, message: 'ทดสอบระบบ: บริการเอกสารไม่พร้อม' }) }), { times: 1 });
      await page.getByRole('button', { name: /พิมพ์/ }).first().click();
      await page.getByText('เปิด PDF ไม่สำเร็จ').waitFor({ timeout: 30_000 });
      await page.getByText('ทดสอบระบบ: บริการเอกสารไม่พร้อม').waitFor();
      const shotError = await shot(page, 'expense-pdf-preview-error-1440.png');
      await page.getByRole('button', { name: 'ลองใหม่' }).click();
      await page.getByRole('link', { name: 'ดาวน์โหลด PDF' }).waitFor({ timeout: 60_000 });
      await page.getByRole('button', { name: 'ปิดตัวอย่าง' }).click();
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/preview-retry`, title: 'PdfPreview: 503 → error panel with the server message and ลองใหม่; retry renders the preview and download link', routes: ['GET /api/expense-documents/:id/voucher.pdf'], artifacts: [shotError] }));
    } finally {
      await context.close();
    }
  });

  it('no outbound transport was used by the browser flows', () => {
    expect(h.external.calls).toEqual([]);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: 'Outbound recorder stayed empty', routes: [], renderer: 'none', artifacts: [] }));
  });
});
