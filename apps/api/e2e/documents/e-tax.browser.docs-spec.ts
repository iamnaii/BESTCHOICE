import { join } from 'path';
import type { BrowserContext, Page } from '@playwright/test';
import request from 'supertest';
import { DOCUMENT_STYLE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { activateContract } from './support/receipts-fixtures';
import { attachBranchToCompany, createLongAddressCustomer, createVatContract, installSyntheticRd, SYNTHETIC_RD_CONFIG, synthesizeCertificate, SyntheticRd, VatContract } from './support/e-tax-fixtures';
import { downloadBytes, startWeb, WebRuntime } from './support/web';
import { domainDir, recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { isA4, parsePdf, ParsedPdf } from './support/pdf';

/**
 * DOC-07 browser evidence (issue #1566): the live document center at
 * /finance/e-tax in the real admin web app against this run's API — company
 * filter, per-row status from the submissions list, the ACCEPTED-only PDF
 * button, the authenticated download through the configured API base, error
 * + retry, and what happens to a download when the working company changes.
 */
const DOMAIN = 'e-tax-browser';
const GUARDS = ['real login form → POST /api/auth/login', 'JwtAuthGuard', 'RolesGuard', 'ETaxService company→branch scoping', 'EntityScopeInterceptor (?company= from the work zone)'];
const SIMULATED = [
  'Revenue Department = jest spy on RdApiClient.prototype; statuses reached through the real generate/sign/submit/poll routes before the browser starts',
  'PKCS#7 signature with a self-signed openssl certificate generated for this run',
  'LINE/SMS/e-mail transports recorded, never sent; private local storage',
  'web served by the Vite dev server (same source as the production bundle); in-app routing after one real login per viewport',
  'error path = the PDF request intercepted once by Playwright with a 503 JSON body',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['TAX_INVOICE'], guards: GUARDS, renderer: 'jspdf', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});
const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
const fmt = (value: string | number) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe('DOC-07 browser evidence — /finance/e-tax document center', () => {
  let h: DocumentsHarness;
  let web: WebRuntime;
  let world: DocumentsWorld;
  let owner: Session;
  let rd: SyntheticRd;
  let contractA: VatContract;
  let contractLong: VatContract;
  let contractB: VatContract;
  let financeLabel: string;
  let shopLabel: string;
  let acceptedPaymentId: string;
  let apiRender: ParsedPdf;
  let outboundAfterBookings = 0;
  const amounts: Record<string, { base: string; vat: string; total: string }> = {};

  const ok = async (test: request.Test, status: number, label: string): Promise<request.Response> => {
    const response = await test;
    if (response.status !== status) throw new Error(`${label} → ${response.status} (expected ${status}) ${JSON.stringify(response.body).slice(0, 300)}`);
    return response;
  };
  const shot = async (page: Page, name: string) => saveArtifact(DOMAIN, name, await page.screenshot({ fullPage: true })).relativePath;
  const consoleNote = (errors: string[]) => (errors.length ? `console errors: ${errors.join(' | ').slice(0, 400)}` : 'no console errors');
  const settle = async (page: Page) => { await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined); };
  const linesOf = (pdf: ParsedPdf) => pdf.pages.map((p) => p.lines.join('\n')).join('\f');
  const row = (page: Page, contractNumber: string, installmentNo: number) =>
    page.locator('tr').filter({ hasText: contractNumber }).filter({ has: page.locator('td', { hasText: new RegExp(`^${installmentNo}$`) }) }).first();
  const pdfButton = (page: Page, contractNumber: string, installmentNo: number) => page.getByRole('button', { name: `ดาวน์โหลด PDF ${contractNumber} งวด ${installmentNo}`, exact: true });
  // CompanyFilter renders a native <select>; its "นิติบุคคล" label is not associated (no htmlFor), so locate by the option set.
  const companySelect = (page: Page) => page.locator('select').filter({ has: page.locator('option', { hasText: '(FINANCE)' }) }).first();
  const selectCompany = async (page: Page, label: string) => {
    await companySelect(page).waitFor({ timeout: 30_000 });
    await companySelect(page).selectOption({ label });
  };
  const waitForText = async (page: Page, text: string, label: string) => {
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ timeout: 45_000 });
    } catch (error) {
      await page.screenshot({ path: join(domainDir(DOMAIN), `failure-${label}.png`), fullPage: true }).catch(() => undefined);
      const body = await page.locator('body').innerText().catch(() => '');
      saveArtifact(DOMAIN, `failure-${label}.txt`, `${page.url()}\n\n${body.slice(0, 4000)}`);
      throw new Error(`${label}: "${text}" not visible at ${page.url()} — ${String((error as Error).message).split('\n')[0]}`);
    }
  };
  const expectDownload = async (page: Page, trigger: () => Promise<void>, filename: string) => {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), trigger()]);
    expect(download.suggestedFilename()).toBe(filename);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    return bytes;
  };
  const noDownloadWithin = async (page: Page, ms: number) => {
    let seen = false;
    const listener = () => { seen = true; };
    page.on('download', listener);
    await new Promise((resolve) => setTimeout(resolve, ms));
    page.off('download', listener);
    return !seen;
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    owner = await h.login(world.users.owner.email, world.password);
    const financeManager = await h.login(world.users.financeManager.email, world.password);
    const salesA = await h.login(world.users.salesA.email, world.password);
    await attachBranchToCompany(h.prisma, world.branches.a.id, 'FINANCE');
    await attachBranchToCompany(h.prisma, world.branches.b.id, 'SHOP');
    const finance = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
    const shop = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP' } });
    financeLabel = `${finance.nameTh} (FINANCE)`;
    shopLabel = `${shop.nameTh} (SHOP)`;
    const longCustomer = await createLongAddressCustomer(h.prisma, world.prefix);
    const make = async (label: string, branchId: string, customerId: string, salespersonId: string) => {
      const contract = await createVatContract(h.prisma, { prefix: world.prefix, label, branchId, customerId, salespersonId });
      await activateContract(h.app, contract.id);
      return contract;
    };
    contractA = await make('A', world.branches.a.id, world.customer.id, world.users.salesA.id);
    contractLong = await make('L', world.branches.a.id, longCustomer.id, world.users.salesA.id);
    contractB = await make('B', world.branches.b.id, world.customer.id, world.users.salesB.id);
    // Two bookings per 11 s (shared throttler, DOC-01 observation).
    const payers = [salesA, financeManager, owner, financeManager];
    const times: number[] = [];
    let seq = 0;
    const pay = async (contract: VatContract, installmentNo: number) => {
      const window = times.filter((at) => Date.now() - at < 11_000);
      if (window.length >= 2) await new Promise((resolve) => setTimeout(resolve, 11_000 - (Date.now() - window[0]) + 250));
      times.push(Date.now());
      const session = payers[seq % payers.length];
      await ok(h.client({ session }).post('/payments/record', { contractId: contract.id, installmentNo, amount: Number(contract.installments[installmentNo - 1].amountDue), paymentMethod: 'CASH', depositAccountCode: '11-1101', case: 'NORMAL', transactionRef: `${world.prefix}-ETW-${++seq}` }), 201, `POST /payments/record ${contract.contractNumber}#${installmentNo}`);
      const payment = await h.prisma.payment.findUniqueOrThrow({ where: { id: contract.installments[installmentNo - 1].paymentId } });
      const vat = payment.vatAmount!;
      amounts[payment.id] = { base: payment.amountPaid.minus(vat).toFixed(2), vat: vat.toFixed(2), total: payment.amountPaid.toFixed(2) };
      return payment.id;
    };
    acceptedPaymentId = await pay(contractA, 1);
    const pendingPaymentId = await pay(contractA, 2);
    const rejectedPaymentId = await pay(contractLong, 1);
    await pay(contractB, 1);
    outboundAfterBookings = h.external.calls.length;
    // Statuses through the real lifecycle against the synthetic RD.
    rd = installSyntheticRd();
    const cert = synthesizeCertificate(join(domainDir(DOMAIN), 'synthetic-cert'));
    await ok(h.client({ session: owner }).put('/integrations/e-tax/config', { submitMode: 'enabled', certPath: cert.certPath, certPassword: cert.password, ...SYNTHETIC_RD_CONFIG }), 200, 'e-tax config');
    const generate = async (paymentId: string) => (await ok(h.client({ session: owner }).post(`/e-tax-xml/generate/${paymentId}`), 201, 'generate')).body.data as { id: string };
    const accepted = await generate(acceptedPaymentId);
    await ok(h.client({ session: owner }).post(`/e-tax-xml/${accepted.id}/sign`), 201, 'sign');
    rd.submitVerdict = 'ACCEPT';
    await ok(h.client({ session: owner }).post(`/e-tax-xml/${accepted.id}/submit`), 201, 'submit');
    rd.pollStatus = 'ACCEPTED';
    await ok(h.client({ session: owner }).post(`/e-tax-xml/${accepted.id}/poll`), 201, 'poll');
    await generate(pendingPaymentId);
    const rejected = await generate(rejectedPaymentId);
    await ok(h.client({ session: owner }).post(`/e-tax-xml/${rejected.id}/sign`), 201, 'sign L');
    rd.submitVerdict = 'REJECT';
    await ok(h.client({ session: owner }).post(`/e-tax-xml/${rejected.id}/submit`), 201, 'submit L');
    const statuses = await h.prisma.eTaxSubmission.findMany({ select: { paymentId: true, status: true, invoiceNumber: true } });
    expect(statuses.find((s) => s.paymentId === acceptedPaymentId)?.status).toBe('ACCEPTED');
    apiRender = await parsePdf(bodyBuffer(await ok(h.client({ session: owner, company: 'FINANCE' }).get(`/e-tax/invoices/${acceptedPaymentId}/pdf`), 200, 'api pdf')));
    web = await startWeb(h);
  }, 300000);

  afterAll(async () => {
    await web?.close();
    rd?.restore();
    await h?.close();
  });

  for (const viewport of VIEWPORTS) {
    const w = viewport.width;
    describe(`${w}px`, () => {
      let context: BrowserContext;
      let page: Page;
      let errors: string[];
      const responses: Array<{ url: string; status: number }> = [];
      const requests: Array<{ url: string; authorization: boolean; company: string | null }> = [];
      beforeAll(async () => {
        ({ context, page, errors } = await web.page(viewport));
        page.on('response', (response) => { if (/\/api\/admin\/(e-tax|e-tax-xml|companies)/.test(response.url())) responses.push({ url: response.url().replace(web.origin, ''), status: response.status() }); });
        page.on('request', (req) => { if (/\/e-tax\/invoices\/[^/]+\/pdf/.test(req.url())) requests.push({ url: req.url().replace(web.origin, ''), authorization: /^Bearer /.test(req.headers().authorization ?? ''), company: new URL(req.url()).searchParams.get('company') }); });
        await web.login(page, world.users.owner.email, world.password);
      }, 120000);
      afterAll(async () => { await context?.close(); });

      it('company filter + per-row status: ACCEPTED shows the PDF button, PENDING shows none, REJECTED offers regeneration, SHOP branch rows appear only under SHOP', async () => {
        await web.navigate(page, '/finance/e-tax');
        await waitForText(page, 'e-Tax Invoice', `page-${w}`);
        await page.getByText('กรุณาเลือกบริษัทเพื่อดูรายการ e-Tax Invoice').waitFor({ timeout: 30_000 });
        await selectCompany(page, financeLabel);
        await waitForText(page, contractA.contractNumber, `rows-${w}`);
        await settle(page);
        const acceptedRow = row(page, contractA.contractNumber, 1);
        await acceptedRow.getByText('สรรพากรรับ', { exact: true }).waitFor({ timeout: 30_000 });
        await pdfButton(page, contractA.contractNumber, 1).waitFor({ timeout: 30_000 });
        const money = amounts[acceptedPaymentId];
        for (const value of [fmt(money.base), fmt(money.vat), fmt(money.total)]) await acceptedRow.getByText(value, { exact: true }).waitFor({ timeout: 10_000 });
        const pendingRow = row(page, contractA.contractNumber, 2);
        await pendingRow.getByText('รอเซ็น', { exact: true }).waitFor({ timeout: 10_000 });
        expect(await pdfButton(page, contractA.contractNumber, 2).count()).toBe(0);
        expect(await pendingRow.getByRole('button', { name: 'สร้าง XML ใหม่' }).count()).toBe(0);
        const rejectedRow = row(page, contractLong.contractNumber, 1);
        await rejectedRow.getByText('ปฏิเสธ', { exact: true }).waitFor({ timeout: 10_000 });
        expect(await pdfButton(page, contractLong.contractNumber, 1).count()).toBe(0);
        expect(await rejectedRow.getByRole('button', { name: 'สร้าง XML ใหม่' }).count()).toBe(1);
        expect(await page.getByText(contractB.contractNumber).count()).toBe(0);
        const shotFinance = await shot(page, `document-center-finance-${w}.png`);
        await selectCompany(page, shopLabel);
        await waitForText(page, contractB.contractNumber, `shop-rows-${w}`);
        const shopRow = row(page, contractB.contractNumber, 1);
        expect(await shopRow.getByRole('button', { name: 'สร้าง XML ใหม่' }).count()).toBe(1);
        expect(await pdfButton(page, contractB.contractNumber, 1).count()).toBe(0);
        expect(await page.getByText(contractA.contractNumber).count()).toBe(0);
        const shotShop = await shot(page, `document-center-shop-${w}.png`);
        await selectCompany(page, financeLabel);
        await waitForText(page, contractA.contractNumber, `rows-again-${w}`);
        const submissionsCall = responses.find((r) => /\/e-tax-xml\?/.test(r.url));
        expect(submissionsCall?.status).toBe(200);
        expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
        recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/document-center-${w}`, title: `${w}px /finance/e-tax: FINANCE filter lists the 3 branch-A payments with statuses สรรพากรรับ / รอเซ็น / ปฏิเสธ, PDF button only on the ACCEPTED row, regenerate only on REJECTED and unsubmitted rows; SHOP filter shows the branch-B payment only`, documents: ['TAX_INVOICE_LIST'], routes: ['GET /api/companies', 'GET /api/e-tax/invoices', 'GET /api/e-tax-xml'], artifacts: [shotFinance, shotShop, saveArtifact(DOMAIN, `api-calls-${w}.json`, JSON.stringify(responses, null, 2)).relativePath], notes: `${consoleNote(errors)}; submissions list request ${submissionsCall?.url} → ${submissionsCall?.status}` }));
      });

      it('PDF button downloads tax-invoice-<contract>-<installment>.pdf through the configured API base with the bearer token; the bytes are the API render', async () => {
        await settle(page);
        const bytes = await expectDownload(page, () => pdfButton(page, contractA.contractNumber, 1).click(), `tax-invoice-${contractA.contractNumber}-1.pdf`);
        const pdf = await parsePdf(bytes);
        expect(pdf.pages.every(isA4)).toBe(true);
        expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
        expect(linesOf(pdf)).toBe(linesOf(apiRender));
        const req = requests[requests.length - 1];
        expect(req).toMatchObject({ authorization: true, company: 'finance' });
        expect(req.url).toContain(`/api/admin/e-tax/invoices/${acceptedPaymentId}/pdf`);
        expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
        recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/download-${w}`, title: `${w}px ACCEPTED row → ดาวน์โหลด PDF → tax-invoice-${contractA.contractNumber}-1.pdf; request carries Bearer + ?company=finance on the /api/admin base; content identical to GET /e-tax/invoices/:id/pdf`, routes: ['GET /api/e-tax/invoices/:paymentId/pdf'], artifacts: [saveArtifact(DOMAIN, `tax-invoice-download-${w}.pdf`, bytes).relativePath, saveArtifact(DOMAIN, `download-request-${w}.json`, JSON.stringify(req, null, 2)).relativePath], notes: consoleNote(errors) }));
      });

      it('a failed download shows the server message as a toast and the next click succeeds; a company change while downloading aborts without saving a file', async () => {
        await settle(page);
        await page.route('**/e-tax/invoices/*/pdf*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, message: 'ทดสอบระบบ: e-Tax ไม่พร้อมให้บริการ' }) }), { times: 1 });
        await pdfButton(page, contractA.contractNumber, 1).click();
        await page.getByText('ทดสอบระบบ: e-Tax ไม่พร้อมให้บริการ').waitFor({ timeout: 30_000 });
        const shotError = await shot(page, `download-error-${w}.png`);
        await settle(page);
        await expectDownload(page, () => pdfButton(page, contractA.contractNumber, 1).click(), `tax-invoice-${contractA.contractNumber}-1.pdf`);
        // Company change: hold the PDF response, switch the work zone to SHOP mid-flight.
        await page.route('**/e-tax/invoices/*/pdf*', async (route) => { await new Promise((resolve) => setTimeout(resolve, 2500)); await route.continue(); }, { times: 1 });
        await pdfButton(page, contractA.contractNumber, 1).click();
        await page.getByRole('status').filter({ hasText: 'กำลังโหลด' }).first().waitFor({ timeout: 10_000 });
        await web.navigate(page, '/customers?zone=shop');
        const aborted = await noDownloadWithin(page, 5000);
        expect(aborted).toBe(true);
        const toasts = await page.locator('[data-sonner-toast]').allInnerTexts();
        await web.navigate(page, '/finance/e-tax');
        await waitForText(page, 'e-Tax Invoice', `back-${w}`);
        recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/error-retry-company-change-${w}`, title: `${w}px 503 from the PDF route → toast with the server message, next click downloads; switching the work company mid-download aborts the request (no file, toasts: ${toasts.length})`, routes: ['GET /api/e-tax/invoices/:paymentId/pdf'], artifacts: [shotError], notes: `${consoleNote(errors)}; toasts after the company change: ${JSON.stringify(toasts).slice(0, 200)}. The page unmounts on a zone change (LayoutProvider re-scopes), so DocumentDownloadButton aborts its in-flight request; the scope-revision check in downloadProtectedDocument is the second guard` }));
      });
    });
  }

  it('no outbound transport was used by the browser flows (only the recorded LINE receipts of the setup bookings)', () => {
    expect(h.external.calls.length).toBe(outboundAfterBookings);
    expect(h.external.calls.every((call) => call.channel === 'line' && call.recipient.startsWith('TEST-NOT-SENT-'))).toBe(true);
    expect(rd.calls.map((call) => call.op)).toEqual(['submit', 'checkStatus', 'submit']);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: `Outbound recorder: ${outboundAfterBookings} LINE receipt pushes recorded during setup bookings (never sent), nothing from the browser flows; RD spy saw only the setup lifecycle (2 submits, 1 status check)`, routes: [], renderer: 'none', artifacts: [] }));
  });
});
