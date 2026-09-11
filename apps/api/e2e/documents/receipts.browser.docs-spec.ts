import { join } from 'path';
import type { BrowserContext, Page } from '@playwright/test';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { activateContract, createFinancedContract, FinancedContract, grantApprovalPermissions } from './support/receipts-fixtures';
import { downloadBytes, startWeb, WebRuntime } from './support/web';
import { recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { contentSignature, parsePdf } from './support/pdf';
import { InstallmentAccrual2ATemplate } from '../../src/modules/journal/cpa-templates/installment-accrual-2a.template';

/**
 * DOC-01 browser evidence (issue #1560): the real admin web app (Vite dev
 * server, same source as apps/web) talking to the in-process API of this run
 * through the Vite proxy. The OWNER logs in through the real form once per
 * viewport and moves between pages the way the sidebar does (in-app routing);
 * every download button hits GET /receipts/:id/pdf with the real JWT + ?company=.
 *
 * Covered download points: ReceiptsTab (/payments?tab=receipts),
 * ContractPaymentSchedule + PaymentHistorySheet (/contracts/:id) and
 * RepossessionsPage (/repossessions), at 1440 and 390 px, plus the
 * DocumentDownloadButton behaviours (double click, failure + retry, leaving the
 * page or switching company while a request is in flight).
 */
const DOMAIN = 'receipts-browser';
const GUARDS = ['real login form → POST /api/auth/login', 'JwtAuthGuard', 'RolesGuard', 'BranchGuard', 'ReceiptAccessGuard', 'ExportEnabledGuard', 'EntityScopeInterceptor (?company= from the sidebar work selection)'];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded, never sent',
  'private local storage instead of GCS/S3',
  'synthetic company/branches/users/customer/contracts; installments 1–2 paid and one repossession prepared through the API before the browser starts',
  'web served by the Vite dev server (same source as the production bundle, not the built assets)',
  'page changes use in-app routing (pushState) after one real login per viewport — a full reload needs POST /auth/refresh, throttled 10/min per IP shared by every context here',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['RECEIPT'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});
type ReceiptRow = { id: string; receiptNumber: string; receiptType: string; installmentNo: number | null; isVoided: boolean; cnSource: string | null };
const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];

describe('DOC-01 browser evidence — receipts download points in the real web app', () => {
  let h: DocumentsHarness;
  let web: WebRuntime;
  let world: DocumentsWorld;
  let owner: Session;
  let contract: FinancedContract;
  let repossessed: FinancedContract;
  let receipt: ReceiptRow;
  let creditNote: ReceiptRow;
  let apiSignature: string;
  let cnSignature: string;

  const receiptsOf = async (contractId: string): Promise<ReceiptRow[]> => {
    const response = await h.client({ session: owner }).get(`/receipts/contract/${contractId}`).expect(200);
    return (Array.isArray(response.body.data) ? response.body.data : response.body.data.data) as ReceiptRow[];
  };
  const apiPdf = async (id: string) => bodyBuffer(await h.client({ session: owner }).get(`/receipts/${id}/pdf`).expect(200));
  const pay = async (installmentNo: number) => {
    const response = await h.client({ session: owner }).post('/payments/record', { contractId: contract.id, installmentNo, amount: contract.installmentTotal.toNumber(), paymentMethod: 'CASH', depositAccountCode: '11-1101', case: 'NORMAL', transactionRef: `${world.prefix}-WEB-${installmentNo}` });
    if (response.status !== 201) throw new Error(`POST /payments/record → ${response.status} ${JSON.stringify(response.body)}`);
  };
  const downloadButtonNear = (page: Page, text: string, title: string) =>
    page.locator('tr, li, article, section, div').filter({ hasText: text }).filter({ has: page.getByTitle(title) }).last().getByTitle(title).first();
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
  const shot = async (page: Page, name: string) => saveArtifact(DOMAIN, name, await page.screenshot({ fullPage: true })).relativePath;
  /** Wait for `text`; on timeout keep a screenshot + DOM excerpt so the failure is diagnosable. */
  const waitForText = async (page: Page, text: string, label: string) => {
    try {
      await page.getByText(text, { exact: true }).first().waitFor({ timeout: 45_000 });
    } catch (error) {
      const url = page.url();
      await page.screenshot({ path: join(process.env.DOCS_QA_OUTPUT!, DOMAIN, `failure-${label}.png`), fullPage: true }).catch(() => undefined);
      const body = await page.locator('body').innerText().catch(() => '');
      saveArtifact(DOMAIN, `failure-${label}.txt`, `${url}\n\n${body.slice(0, 4000)}`);
      throw new Error(`${label}: "${text}" not visible at ${url} — ${String((error as Error).message).split('\n')[0]}`);
    }
  };
  const openReceiptsTab = async (page: Page, label: string) => {
    await web.navigate(page, '/payments?tab=receipts');
    await waitForText(page, receipt.receiptNumber, label);
  };
  const consoleNote = (errors: string[]) => (errors.length ? `console errors: ${errors.join(' | ').slice(0, 500)}` : 'no console errors');

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    owner = await h.login(world.users.owner.email, world.password);
    await grantApprovalPermissions(h.prisma, owner.user.id, ['EARLY_PAYOFF', 'VOID_RECEIPT']);
    contract = await createFinancedContract(h.prisma, { prefix: world.prefix, label: 'WEB', branchId: world.branches.a.id, customerId: world.customer.id, salespersonId: world.users.salesA.id });
    await activateContract(h.app, contract.id);
    await pay(1);
    await pay(2);
    receipt = (await receiptsOf(contract.id)).find((row) => row.installmentNo === 1 && !row.isVoided)!;
    apiSignature = contentSignature(await parsePdf(await apiPdf(receipt.id)));

    repossessed = await createFinancedContract(h.prisma, { prefix: world.prefix, label: 'WEBR', branchId: world.branches.a.id, customerId: world.customer.id, salespersonId: world.users.salesA.id });
    await activateContract(h.app, repossessed.id);
    const accrual = h.app.get(InstallmentAccrual2ATemplate);
    for (const installmentNo of [1, 2]) {
      const schedule = await h.prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: repossessed.id, installmentNo } });
      await accrual.execute(schedule.id);
    }
    await h.prisma.contract.update({ where: { id: repossessed.id }, data: { status: 'OVERDUE' } });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const created = await h.client({ session: owner }).post('/repossessions', { contractId: repossessed.id, repossessedDate: today, conditionGrade: 'B', appraisalPrice: 3000, returnReason: 'UNAFFORDABLE', notes: 'ทดสอบระบบ ยึดคืน (browser)' });
    if (created.status !== 201) throw new Error(`POST /repossessions → ${created.status} ${JSON.stringify(created.body)}`);
    creditNote = (await receiptsOf(repossessed.id)).find((row) => row.receiptType === 'CREDIT_NOTE')!;
    cnSignature = contentSignature(await parsePdf(await apiPdf(creditNote.id)));

    web = await startWeb(h);
  }, 180000);

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

      it('OWNER logs in through the real form and downloads from the receipts tab', async () => {
        await openReceiptsTab(page, `receipts-tab-${w}`);
        const shotBefore = await shot(page, `receipts-tab-${w}.png`);
        const button = downloadButtonNear(page, receipt.receiptNumber, 'ดาวน์โหลดใบเสร็จ PDF');
        const bytes = await expectDownload(page, () => button.click(), `${receipt.receiptNumber}.pdf`);
        expect(contentSignature(await parsePdf(bytes))).toBe(apiSignature);
        const artifact = saveArtifact(DOMAIN, `receipts-tab-download-${w}.pdf`, bytes);
        expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
        recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/receipts-tab-${w}`, title: `${w}px receipts tab: real login, DocumentDownloadButton saves ${receipt.receiptNumber}.pdf with the same content the API renders`, routes: ['POST /api/auth/login', 'GET /api/receipts', 'GET /api/receipts/:id/pdf'], artifacts: [shotBefore, artifact.relativePath], notes: consoleNote(errors) }));
      });

      it('contract page — installment history link and payment history sheet download the same receipt', async () => {
        await web.navigate(page, `/contracts/${contract.id}`);
        await page.getByRole('button', { name: /ดูประวัติ/ }).first().waitFor({ timeout: 60_000 });
        await page.getByRole('button', { name: /ดูประวัติ/ }).first().click();
        await page.getByRole('button', { name: receipt.receiptNumber, exact: true }).first().waitFor();
        const shotSchedule = await shot(page, `contract-schedule-${w}.png`);
        const fromSchedule = await expectDownload(page, () => page.getByRole('button', { name: receipt.receiptNumber, exact: true }).first().click(), `${receipt.receiptNumber}.pdf`);
        expect(contentSignature(await parsePdf(fromSchedule))).toBe(apiSignature);
        await page.getByRole('button', { name: 'ประวัติการชำระ' }).click();
        const sheetButton = page.getByRole('button', { name: `ดาวน์โหลดใบเสร็จ ${receipt.receiptNumber}` });
        await sheetButton.waitFor({ timeout: 60_000 });
        const shotSheet = await shot(page, `payment-history-sheet-${w}.png`);
        const fromSheet = await expectDownload(page, () => sheetButton.click(), `${receipt.receiptNumber}.pdf`);
        expect(contentSignature(await parsePdf(fromSheet))).toBe(apiSignature);
        await page.keyboard.press('Escape');
        expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
        recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/contract-page-${w}`, title: `${w}px contract page: installment history link and PaymentHistorySheet both save ${receipt.receiptNumber}.pdf`, routes: ['GET /api/contracts/:id', 'GET /api/receipts/contract/:contractId', 'GET /api/receipts/:id/pdf'], artifacts: [shotSchedule, shotSheet], notes: consoleNote(errors) }));
      });

      it('repossessions page downloads the credit note', async () => {
        await web.navigate(page, '/repossessions');
        const button = page.getByRole('button', { name: 'ใบลดหนี้' }).first();
        await button.waitFor({ timeout: 60_000 });
        const shotList = await shot(page, `repossessions-${w}.png`);
        const bytes = await expectDownload(page, () => button.click(), `${creditNote.receiptNumber}.pdf`);
        expect(contentSignature(await parsePdf(bytes))).toBe(cnSignature);
        expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
        recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/repossessions-${w}`, title: `${w}px repossessions page: ใบลดหนี้ button saves ${creditNote.receiptNumber}.pdf (cnSource REPOSSESSION)`, documents: ['CREDIT_NOTE'], routes: ['GET /api/repossessions', 'GET /api/receipts/:id/pdf'], artifacts: [shotList, saveArtifact(DOMAIN, `repossession-credit-note-${w}.pdf`, bytes).relativePath], notes: consoleNote(errors) }));
      });
    });
  }

  it('1440px: double click saves once, a failed request shows a toast and the retry succeeds, leaving the page or switching company mid-request saves nothing', async () => {
    const { context, page } = await web.page(VIEWPORTS[0]);
    const pdfRoute = '**/receipts/*/pdf*';
    try {
      await web.login(page, world.users.owner.email, world.password);
      await openReceiptsTab(page, 'behaviours-start');
      const button = () => downloadButtonNear(page, receipt.receiptNumber, 'ดาวน์โหลดใบเสร็จ PDF');

      // 1. Double click → exactly one download (button is disabled while the request is pending).
      const downloads: string[] = [];
      page.on('download', (download) => downloads.push(download.suggestedFilename()));
      await button().dblclick();
      await new Promise((resolve) => setTimeout(resolve, 4000));
      expect(downloads).toEqual([`${receipt.receiptNumber}.pdf`]);

      // 2. Server failure → toast with the server message, nothing saved; retry → saved.
      await page.route(pdfRoute, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, message: 'ดาวน์โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่' }) }), { times: 1 });
      await button().click();
      await page.getByText('ดาวน์โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่').first().waitFor({ timeout: 15_000 });
      expect(downloads).toHaveLength(1);
      const shotToast = await shot(page, 'receipts-tab-download-failed-1440.png');
      await expectDownload(page, () => button().click(), `${receipt.receiptNumber}.pdf`);
      expect(downloads).toHaveLength(2);

      // 3. Leave the page (in-app navigation) while the request is in flight → aborted, nothing saved, no error toast.
      await page.route(pdfRoute, async (route) => { await new Promise((resolve) => setTimeout(resolve, 2500)); await route.continue().catch(() => undefined); });
      await button().click();
      await web.navigate(page, '/dashboard');
      expect(await noDownloadWithin(page, 4000)).toBe(true);
      expect(await page.getByText('ไม่สำเร็จ').count()).toBe(0);
      await page.unroute(pdfRoute);

      // 4. Switch the work company while the request is in flight → nothing saved for the old scope.
      await openReceiptsTab(page, 'behaviours-after-dashboard');
      await page.route(pdfRoute, async (route) => { await new Promise((resolve) => setTimeout(resolve, 2500)); await route.continue().catch(() => undefined); });
      const expand = page.getByRole('button', { name: 'ขยายเมนู', exact: true });
      if (await expand.count()) await expand.click();
      const shopTab = page.getByRole('tab', { name: 'งานหน้าร้าน (SHOP)', exact: true });
      const financeTab = page.getByRole('tab', { name: 'งานการเงิน (FINANCE)', exact: true });
      const target = (await shopTab.getAttribute('aria-selected')) === 'true' ? financeTab : shopTab;
      await button().click();
      await target.click();
      expect(await noDownloadWithin(page, 4000)).toBe(true);
      const scopeToast = await page.getByText('เปลี่ยนบริษัทระหว่างดาวน์โหลด').count();
      await page.unroute(pdfRoute);
      expect(downloads).toHaveLength(2);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/button-behaviours`, title: 'DocumentDownloadButton: double click → 1 file; 503 → toast, retry → file; navigate away mid-request → nothing; company switch mid-request → nothing', routes: ['GET /api/receipts/:id/pdf'], artifacts: [shotToast], notes: scopeToast ? 'company switch surfaced the "เปลี่ยนบริษัทระหว่างดาวน์โหลด" toast' : 'company switch unmounted the list (request aborted) — no toast, no file' }));
    } finally {
      await context.close();
    }
  });

  it('no outbound transport was used by the browser flows', () => {
    expect(h.external.calls.filter((call) => call.channel !== 'line')).toEqual([]);
    expect(h.external.calls.every((call) => call.recipient.startsWith('TEST-NOT-SENT'))).toBe(true);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: `Outbound recorder: ${h.external.calls.length} LINE call(s) captured, 0 sent`, routes: [], renderer: 'none', artifacts: [] }));
  });
});
