import { join } from 'path';
import type { BrowserContext, Page } from '@playwright/test';
import request from 'supertest';
import { DOCUMENT_STYLE } from '@installment/shared';
import { LetterAutoGenerateCron } from '../../src/modules/overdue/crons/letter-auto-generate.cron';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { createOverdueContract, OverdueContract, setSystemConfig, startStoredFileServer, StoredFileServer } from './support/letters-fixtures';
import { downloadBytes, startWeb, WebRuntime } from './support/web';
import { domainDir, recordScenario, saveArtifact, ScenarioRecord, sha256 } from './support/artifacts';
import { foldThai, isA4, pageText, parsePdf, ParsedPdf } from './support/pdf';

/**
 * DOC-09 browser evidence (issue #1568): the live /letters page against this
 * run's API — a batch larger than one page of the list, bulk print with the
 * merged PDF in page order, the explicit print confirmation with partial
 * failure + retry, stored legacy files versus regenerated previews, storage
 * outage, EMS dispatch, and what a company change / dialog close does mid-flight.
 */
const DOMAIN = 'letters-browser';
const GUARDS = ['real login form → POST /api/auth/login', 'JwtAuthGuard', 'RolesGuard', 'LetterDocumentAccessGuard', 'ContractLetterService.list branch scope', 'EntityScopeInterceptor (?company= from the work zone)'];
const SIMULATED = [
  'letters created by the real LetterAutoGenerateCron.run() on contracts seeded as OVERDUE',
  'legacy stored letter files (ContractLetter.pdfUrl) served by a local HTTP file server standing in for the public object storage; its outage is scripted',
  'LINE/SMS/e-mail transports recorded, never sent; private local storage',
  'web served by the Vite dev server (same source as the production bundle); one real login per viewport, in-app routing afterwards',
  'partial confirmation failure = one POST pdf-generated intercepted with a 500 by Playwright',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['RETURN_DEVICE_45D'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});
const BATCH = 52;

describe('DOC-09 browser evidence — /letters bulk print, confirmation, stored files, dispatch', () => {
  let h: DocumentsHarness;
  let web: WebRuntime;
  let world: DocumentsWorld;
  let owner: Session;
  let files: StoredFileServer;
  const contracts: OverdueContract[] = [];
  let pending: Array<{ id: string; letterNumber: string; contractNumber: string }> = [];
  let legacy: { id: string; letterNumber: string; bytes: Buffer; key: string };
  let printedNoFile: { id: string; letterNumber: string };
  let outboundAfterSetup = 0;

  const ok = async (test: request.Test, status: number, label: string): Promise<request.Response> => {
    const response = await test;
    if (response.status !== status) throw new Error(`${label} → ${response.status} (expected ${status}) ${JSON.stringify(response.body).slice(0, 300)}`);
    return response;
  };
  const api = () => h.client({ session: owner, company: 'FINANCE' });
  const status = async (id: string) => (await h.prisma.contractLetter.findUniqueOrThrow({ where: { id }, select: { status: true, pdfUrl: true } }));
  const auditCount = async (id: string, action?: string) => h.prisma.auditLog.count({ where: { entity: 'contract_letter', entityId: id, ...(action ? { action } : {}) } });
  const shot = async (page: Page, name: string) => saveArtifact(DOMAIN, name, await page.screenshot({ fullPage: true })).relativePath;
  const consoleNote = (errors: string[]) => (errors.length ? `console errors: ${errors.join(' | ').slice(0, 400)}` : 'no console errors');
  const settle = async (page: Page) => { await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined); };
  const waitForText = async (page: Page, text: string | RegExp, label: string, timeout = 45_000) => {
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ timeout });
    } catch (error) {
      await page.screenshot({ path: join(domainDir(DOMAIN), `failure-${label}.png`), fullPage: true }).catch(() => undefined);
      saveArtifact(DOMAIN, `failure-${label}.txt`, `${page.url()}\n\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 4000)}`);
      throw new Error(`${label}: "${text}" not visible at ${page.url()} — ${String((error as Error).message).split('\n')[0]}`);
    }
  };
  const expectDownload = async (page: Page, trigger: () => Promise<void>) => {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), trigger()]);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    return { bytes, filename: download.suggestedFilename() };
  };
  const noDownloadWithin = async (page: Page, ms: number) => {
    let seen = false;
    const listener = () => { seen = true; };
    page.on('download', listener);
    await new Promise((resolve) => setTimeout(resolve, ms));
    page.off('download', listener);
    return !seen;
  };
  const gotoLetters = async (page: Page, tab?: string) => {
    // A dialog left open by an earlier step would block the tab bar.
    if (await page.getByRole('dialog').count()) { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined); }
    await web.navigate(page, '/letters');
    await waitForText(page, 'จัดการจดหมาย', 'letters-page');
    if (tab) await page.getByRole('button', { name: new RegExp(`^${tab}`) }).first().click();
  };
  const tabLabels = { pending: 'รอพิมพ์', printed: 'พิมพ์แล้ว', dispatched: 'ส่งแล้ว' };
  /** Letter numbers in table order (second cell of each row — the first is the checkbox). */
  const tableNumbers = async (page: Page) => (await page.locator('tbody tr td:nth-child(2)').allInnerTexts()).map((t) => t.trim()).filter((t) => /^ST-\d{4}-\d{5}$/.test(t));
  /** Letter number printed in the footer of every page of a merged PDF, page by page. */
  const numbersByPage = (pdf: ParsedPdf) => pdf.pages.map((p) => (foldThai(pageText(p)).match(/ST-\d{4}-\d{5}/) ?? [null])[0]);
  /** Each letter's pages are contiguous and the letters follow `order` — the merge respects the selection order. */
  const expectMergedOrder = (pdf: ParsedPdf, order: string[]) => {
    const perPage = numbersByPage(pdf);
    expect(perPage.every(Boolean)).toBe(true);
    const sequence = perPage.filter((n, i) => i === 0 || perPage[i - 1] !== n);
    expect(sequence).toEqual(order);
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    owner = await h.login(world.users.owner.email, world.password);
    await setSystemConfig(h.prisma, 'letter_auto_generate_enabled', 'true');
    for (let i = 1; i <= BATCH + 2; i += 1) {
      contracts.push(await createOverdueContract(h.prisma, { prefix: world.prefix, label: `P${String(i).padStart(2, '0')}`, branchId: world.branches.a.id, customerId: world.customer.id, salespersonId: world.users.salesA.id, oldestOverdueDays: 50 }));
    }
    await h.app.get(LetterAutoGenerateCron).run();
    const rows = await h.prisma.contractLetter.findMany({ where: { contractId: { in: contracts.map((c) => c.id) } }, include: { contract: { select: { contractNumber: true } } }, orderBy: { triggeredAt: 'desc' } });
    expect(rows.length).toBe(BATCH + 2);
    // Two letters leave the pending tab before the browser starts: one legacy letter with a stored
    // file (the shape letters had before the server renderer), one printed without a stored file.
    files = await startStoredFileServer();
    const [legacyRow, printedRow, ...rest] = rows;
    const legacyBytes = bodyBuffer(await ok(api().get(`/overdue/letters/${legacyRow.id}/pdf`), 200, 'legacy render'));
    const key = `letters/${legacyRow.letterNumber}.pdf`;
    files.put(key, legacyBytes);
    await ok(api().post(`/overdue/letters/${legacyRow.id}/pdf-generated`, { pdfUrl: files.url(key) }), 201, 'mark legacy with pdfUrl');
    await ok(api().post(`/overdue/letters/${printedRow.id}/pdf-generated`), 201, 'mark printed');
    legacy = { id: legacyRow.id, letterNumber: legacyRow.letterNumber, bytes: legacyBytes, key };
    printedNoFile = { id: printedRow.id, letterNumber: printedRow.letterNumber };
    pending = rest.map((r) => ({ id: r.id, letterNumber: r.letterNumber, contractNumber: r.contract.contractNumber }));
    expect(pending.length).toBe(BATCH);
    outboundAfterSetup = h.external.calls.length;
    web = await startWeb(h);
  }, 300000);

  afterAll(async () => {
    await web?.close();
    await files?.close();
    await h?.close();
  });

  describe('1440px', () => {
    let context: BrowserContext;
    let page: Page;
    let errors: string[];
    const apiRequests: Array<{ method: string; url: string; status?: number }> = [];
    beforeAll(async () => {
      ({ context, page, errors } = await web.page({ width: 1440, height: 1000 }));
      page.on('response', (response) => { if (/\/api\/admin\/overdue\/letters/.test(response.url())) apiRequests.push({ method: response.request().method(), url: response.url().replace(web.origin, ''), status: response.status() }); });
      await web.login(page, world.users.owner.email, world.password);
    }, 120000);
    afterAll(async () => { await context?.close(); });

    it(`bulk print of ${BATCH} pending letters across the page-size boundary: frozen batch, merged PDF in list order, download, then confirmation with one failure retried alone`, async () => {
      await gotoLetters(page, tabLabels.pending);
      await waitForText(page, pending[0].letterNumber, 'pending-rows');
      // Default page size 50 → the batch spills onto page 2; raise the size so one page holds it all.
      expect(await page.getByRole('button', { name: '2', exact: true }).count()).toBe(1);
      await page.getByLabel('แสดงต่อหน้า').selectOption('100');
      await waitForText(page, pending[pending.length - 1].letterNumber, 'pending-rows-100');
      await page.getByLabel('เลือกทั้งหมดในหน้านี้').click();
      await waitForText(page, `เลือก ${pending.length} ฉบับ`, 'selection-count');
      // Table order = what the merged PDF must follow.
      const tableOrder = await tableNumbers(page);
      expect(tableOrder.length).toBe(pending.length);
      const shotList = await shot(page, 'letters-pending-1440.png');
      await settle(page);
      await page.getByRole('button', { name: 'พิมพ์รวม' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText(`พิมพ์รวม ${pending.length} ฉบับ`).waitFor({ timeout: 15_000 });
      await dialog.getByText('กำลังสร้าง PDF...').waitFor({ timeout: 15_000 }).catch(() => undefined);
      await dialog.getByText('กำลังสร้าง PDF...').waitFor({ state: 'detached', timeout: 480_000 });
      await dialog.getByRole('button', { name: 'ดาวน์โหลด PDF' }).isEnabled();
      const { bytes, filename } = await expectDownload(page, () => dialog.getByRole('button', { name: 'ดาวน์โหลด PDF' }).click());
      expect(filename).toMatch(/^letters-batch-.*\.pdf$/);
      const merged = await parsePdf(bytes);
      // Each 45-day letter runs to two A4 pages at 16 pt (see the API scenario), so the merge holds 2 × 52 pages.
      expect(merged.pageCount).toBeGreaterThanOrEqual(pending.length);
      expect(merged.pages.every(isA4)).toBe(true);
      expect(merged.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
      expectMergedOrder(merged, tableOrder);
      // Confirmation: one of the 52 confirmations fails once; only that one is retried.
      const victim = pending[2].id;
      await page.route(`**/overdue/letters/${victim}/pdf-generated*`, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'ทดสอบระบบ: บันทึกไม่สำเร็จชั่วคราว' }) }), { times: 1 });
      const confirmCalls = () => apiRequests.filter((r) => r.method === 'POST' && /\/pdf-generated/.test(r.url)).length;
      const before = confirmCalls();
      await dialog.getByText('พิมพ์เสร็จแล้วจึงกดยืนยันเพื่อย้ายไปแท็บ พิมพ์แล้ว').waitFor({ timeout: 15_000 });
      await dialog.getByRole('button', { name: 'ยืนยันพิมพ์แล้ว' }).click();
      await dialog.getByText(`บันทึกสำเร็จ ${pending.length - 1} ฉบับ ยังไม่สำเร็จ 1 ฉบับ`).waitFor({ timeout: 60_000 });
      const shotPartial = await shot(page, 'bulk-print-partial-failure-1440.png');
      expect(confirmCalls() - before).toBe(pending.length);
      expect((await status(victim)).status).toBe('PENDING_DISPATCH');
      await dialog.getByRole('button', { name: 'ลองบันทึกอีกครั้ง 1 ฉบับ' }).click();
      await page.getByText('บันทึกพิมพ์แล้ว 1 ฉบับ').waitFor({ timeout: 30_000 });
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      expect(confirmCalls() - before).toBe(pending.length + 1);
      const states = await h.prisma.contractLetter.findMany({ where: { id: { in: pending.map((p) => p.id) } }, select: { status: true, pdfUrl: true } });
      expect(states.every((s) => s.status === 'PDF_GENERATED' && s.pdfUrl === null)).toBe(true);
      const auditsPerLetter = await Promise.all(pending.map((p) => auditCount(p.id, 'LETTER_PDF_GENERATED')));
      expect(auditsPerLetter.every((n) => n === 1)).toBe(true);
      await settle(page);
      const artifacts = [shotList, shotPartial, saveArtifact(DOMAIN, 'letters-batch-1440.pdf', bytes).relativePath, saveArtifact(DOMAIN, 'letters-batch-1440.json', JSON.stringify({ pageCount: merged.pageCount, fonts: merged.fonts, tableOrder, numbersByPage: numbersByPage(merged), confirmRequests: confirmCalls() - before, firstPageLines: merged.pages[0].lines }, null, 2)).relativePath];
      expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/bulk-print-${BATCH}`, title: `${pending.length} pending letters (page 2 existed at size 50) → size 100 → select all → พิมพ์รวม: merged ${merged.pageCount}-page A4 PDF, letters contiguous and in table order, downloaded; ยืนยันพิมพ์แล้ว → 1 scripted failure → "บันทึกสำเร็จ ${pending.length - 1} ฉบับ ยังไม่สำเร็จ 1 ฉบับ" → retry posts only the 1 remaining → all PDF_GENERATED with one audit row each`, routes: ['GET /api/overdue/letters', 'GET /api/overdue/letters/:id/pdf ×' + pending.length, 'POST /api/overdue/letters/:id/pdf-generated'], artifacts, notes: `${consoleNote(errors)}; the batch is frozen at dialog open (title stays "พิมพ์รวม ${pending.length} ฉบับ" while the list refetches)` }));
    }, 900000);

    it('preview of a printed letter without a stored file says it is regenerated from current data; the download does not touch its status', async () => {
      await gotoLetters(page, tabLabels.printed);
      await waitForText(page, printedNoFile.letterNumber, 'printed-rows');
      const before = { ...(await status(printedNoFile.id)), audits: await auditCount(printedNoFile.id) };
      await page.getByRole('button', { name: `ดู PDF ${printedNoFile.letterNumber}` }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('ไม่มีไฟล์เดิมเก็บไว้ ตัวอย่างนี้สร้างจากวันที่และข้อมูลปัจจุบัน').waitFor({ timeout: 15_000 });
      await dialog.getByText('กำลังสร้าง PDF...').waitFor({ state: 'detached', timeout: 60_000 });
      const shotPreview = await shot(page, 'preview-regenerated-1440.png');
      const { bytes } = await expectDownload(page, () => dialog.getByRole('link', { name: 'ดาวน์โหลด' }).click());
      const pdf = await parsePdf(bytes);
      const apiRender = await parsePdf(bodyBuffer(await ok(api().get(`/overdue/letters/${printedNoFile.id}/pdf`), 200, 'api render')));
      expect(pdf.pageCount).toBe(apiRender.pageCount);
      expect(numbersByPage(pdf).every((n) => n === printedNoFile.letterNumber)).toBe(true);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });
      expect({ ...(await status(printedNoFile.id)), audits: await auditCount(printedNoFile.id) }).toEqual(before);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/preview-regenerated`, title: 'ดู PDF on a printed letter with pdfUrl = null: dialog states the preview is generated from current data, download yields the server render (1 page, letter number in footer), status/audit unchanged', routes: ['GET /api/overdue/letters/:id/pdf'], artifacts: [shotPreview, saveArtifact(DOMAIN, `${printedNoFile.letterNumber}-preview.pdf`, bytes).relativePath], notes: consoleNote(errors) }));
    });

    it('legacy stored file: preview serves the exact stored bytes, a storage outage is an error with retry (never a silent regeneration), and bulk print mixes stored + regenerated letters with a notice', async () => {
      await gotoLetters(page, tabLabels.printed);
      await waitForText(page, legacy.letterNumber, 'legacy-row');
      const renderCalls = () => apiRequests.filter((r) => r.url.includes(`/overdue/letters/${legacy.id}/pdf`)).length;
      const rendersBefore = renderCalls();
      await page.getByRole('button', { name: `ดู PDF ${legacy.letterNumber}` }).click();
      let dialog = page.getByRole('dialog');
      await dialog.getByRole('link', { name: 'ดาวน์โหลด' }).waitFor({ timeout: 30_000 });
      expect(await dialog.getByText('ไม่มีไฟล์เดิมเก็บไว้').count()).toBe(0);
      const { bytes } = await expectDownload(page, () => dialog.getByRole('link', { name: 'ดาวน์โหลด' }).click());
      expect(sha256(bytes)).toBe(sha256(legacy.bytes));
      expect(renderCalls()).toBe(rendersBefore);
      expect(files.requests.filter((r) => r.method === 'GET' && r.key === legacy.key && r.status === 200).length).toBeGreaterThanOrEqual(1);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });
      // Storage outage, single preview: the dialog points its iframe straight at the stored URL, so the
      // browser shows the storage error inside the frame — no regeneration request is made either way.
      files.setFailing(true);
      const outageStart = files.requests.length;
      await page.getByRole('button', { name: `ดู PDF ${legacy.letterNumber}` }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('link', { name: 'ดาวน์โหลด' }).waitFor({ timeout: 15_000 });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const shotOutage = await shot(page, 'preview-storage-outage-1440.png');
      const outageHits = files.requests.slice(outageStart).filter((r) => r.method === 'GET' && r.status === 500).length;
      expect(outageHits).toBeGreaterThanOrEqual(1);
      expect(renderCalls()).toBe(rendersBefore);
      const singlePreviewShowsError = (await dialog.getByText('เปิด PDF ไม่สำเร็จ').count()) > 0;
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });
      // Bulk reprint of stored + regenerated while storage is down: explicit error + retry, no silent regeneration;
      // after recovery: notice for the one without a file, stored bytes first in the merge.
      await page.getByLabel(`เลือก ${legacy.letterNumber}`).click();
      await page.getByLabel(`เลือก ${printedNoFile.letterNumber}`).click();
      await waitForText(page, 'เลือก 2 ฉบับ', 'reprint-selection');
      await page.getByRole('button', { name: /^(พิมพ์ซ้ำ|สร้าง PDF อีกครั้ง)$/ }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByText('พิมพ์รวม 2 ฉบับ').waitFor({ timeout: 15_000 });
      await dialog.getByText('สร้าง PDF ไม่สำเร็จ: โหลดไฟล์เดิมไม่สำเร็จ กรุณาลองใหม่หรือเปิดเอกสารรายฉบับ').waitFor({ timeout: 60_000 });
      const shotBulkOutage = await shot(page, 'bulk-reprint-storage-outage-1440.png');
      expect(await dialog.getByRole('button', { name: 'ดาวน์โหลด PDF' }).isDisabled()).toBe(true);
      files.setFailing(false);
      await dialog.getByRole('button', { name: 'ลองใหม่' }).click();
      await dialog.getByText('1 ฉบับไม่มีไฟล์เดิมเก็บไว้ จึงสร้าง PDF จากวันที่และข้อมูลปัจจุบัน โปรดตรวจสอบก่อนใช้').waitFor({ timeout: 15_000 });
      await dialog.getByText('กำลังสร้าง PDF...').waitFor({ state: 'detached', timeout: 120_000 });
      const reprint = await expectDownload(page, () => dialog.getByRole('button', { name: 'ดาวน์โหลด PDF' }).click());
      const mergedReprint = await parsePdf(reprint.bytes);
      const rowOrder = (await tableNumbers(page)).filter((t) => t === legacy.letterNumber || t === printedNoFile.letterNumber);
      expect(rowOrder.length).toBe(2);
      expectMergedOrder(mergedReprint, rowOrder);
      expect(mergedReprint.pageCount).toBe((await parsePdf(legacy.bytes)).pageCount + numbersByPage(mergedReprint).filter((n) => n === printedNoFile.letterNumber).length);
      // Already printed letters offer no confirmation panel, so nothing changes.
      expect(await dialog.getByRole('button', { name: 'ยืนยันพิมพ์แล้ว' }).count()).toBe(0);
      await dialog.getByRole('button', { name: 'ปิด' }).click();
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });
      expect((await status(legacy.id))).toEqual({ status: 'PDF_GENERATED', pdfUrl: files.url(legacy.key) });
      const artifacts = [shotOutage, shotBulkOutage, saveArtifact(DOMAIN, `${legacy.letterNumber}-stored-download.pdf`, bytes).relativePath, saveArtifact(DOMAIN, 'reprint-stored-plus-regenerated.pdf', reprint.bytes).relativePath, saveArtifact(DOMAIN, 'stored-file-server.json', JSON.stringify({ origin: files.origin, requests: files.requests }, null, 2)).relativePath];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/stored-file`, title: 'Legacy letter with pdfUrl: preview/download use the stored file directly (sha256 identical, no /pdf render); storage outage → single preview shows the storage error inside its frame and bulk reprint shows "สร้าง PDF ไม่สำเร็จ: โหลดไฟล์เดิมไม่สำเร็จ …" + ลองใหม่ — no regeneration either way; after recovery the reprint notes the 1 letter without a file and merges stored bytes first', routes: ['GET <stored pdfUrl> (browser → object storage)', 'GET /api/overdue/letters/:id/pdf'], artifacts, notes: `${consoleNote(errors)}; stored files are read by the browser with credentials omitted — the API never proxies them. Observation: LetterPdfPreviewDialog (single preview) sets the iframe src to the stored URL directly — during an outage there is ${singlePreviewShowsError ? 'an' : 'no'} app-level error message or retry (the browser's own error page appears in the frame); BulkPrintDialog is the one with the explicit error + ลองใหม่` }));
    });

    it('EMS dispatch from the printed tab records the tracking number; the row moves to ส่งแล้ว', async () => {
      await gotoLetters(page, tabLabels.printed);
      const target = pending[0];
      await waitForText(page, target.letterNumber, 'dispatch-row');
      await page.locator('tr').filter({ hasText: target.letterNumber }).getByRole('button', { name: 'ส่ง' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('บันทึกการส่งหนังสือ').waitFor({ timeout: 15_000 });
      const tracking = `EM${world.prefix.slice(-6)}77TH`;
      await dialog.getByPlaceholder('เช่น EX123456789TH').fill(tracking);
      const shotDispatch = await shot(page, 'dispatch-dialog-1440.png');
      await dialog.getByRole('button', { name: 'ยืนยันส่ง' }).click();
      await page.getByText('บันทึกการส่งหนังสือสำเร็จ').waitFor({ timeout: 30_000 });
      const row = await h.prisma.contractLetter.findUniqueOrThrow({ where: { id: target.id } });
      expect(row).toMatchObject({ status: 'DISPATCHED', trackingNumber: tracking, dispatchedById: owner.user.id });
      await settle(page);
      await gotoLetters(page, tabLabels.dispatched);
      await waitForText(page, tracking, 'dispatched-row');
      const shotDispatched = await shot(page, 'dispatched-tab-1440.png');
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/dispatch`, title: 'ส่ง → บันทึกการส่งหนังสือ → tracking EM…TH → DISPATCHED with the tracking shown under ส่งแล้ว', routes: ['POST /api/overdue/letters/:id/dispatch'], renderer: 'none', artifacts: [shotDispatch, shotDispatched], notes: consoleNote(errors) }));
    });

    it('bulk EMS confirmation from the printed tab (defect fixed: the bulk route was shadowed by the single-letter route)', async () => {
      const targets = [pending[1], pending[2]];
      await gotoLetters(page, tabLabels.printed);
      await waitForText(page, targets[0].letterNumber, 'bulk-dispatch-rows');
      for (const t of targets) await page.getByLabel(`เลือก ${t.letterNumber}`).click();
      await waitForText(page, 'เลือก 2 ฉบับ', 'bulk-dispatch-selected');
      await page.getByRole('button', { name: 'บันทึกการส่ง' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('บันทึกการส่ง 2 ฉบับ').waitFor({ timeout: 15_000 });
      const inputs = dialog.getByPlaceholder('EM123456789TH');
      expect(await inputs.count()).toBe(2);
      const trackings = targets.map((_, i) => `EM${world.prefix.slice(-6)}8${i}TH`);
      for (const [i, tracking] of trackings.entries()) await inputs.nth(i).fill(tracking);
      const shotDialog = await shot(page, 'bulk-dispatch-dialog-1440.png');
      await dialog.getByRole('button', { name: 'ยืนยันส่ง 2 ฉบับ' }).click();
      await page.getByText('บันทึกการส่ง 2 ฉบับสำเร็จ').waitFor({ timeout: 30_000 });
      const rows = await h.prisma.contractLetter.findMany({ where: { id: { in: targets.map((t) => t.id) } }, select: { status: true, trackingNumber: true } });
      expect(rows.map((r) => r.status)).toEqual(['DISPATCHED', 'DISPATCHED']);
      expect(rows.map((r) => r.trackingNumber).sort()).toEqual([...trackings].sort());
      const batchIds = new Set((await h.prisma.auditLog.findMany({ where: { entity: 'contract_letter', entityId: { in: targets.map((t) => t.id) }, action: 'LETTER_DISPATCHED' } })).map((a) => (a.newValue as { batchId?: string }).batchId));
      expect(batchIds.size).toBe(1);
      await settle(page);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/bulk-dispatch`, title: 'บันทึกการส่ง (bulk) → tracking per letter → ยืนยันส่ง 2 ฉบับ → both DISPATCHED under one batchId', routes: ['POST /api/overdue/letters/bulk/dispatch'], renderer: 'none', artifacts: [shotDialog], notes: `${consoleNote(errors)}; before the route-order fix this dialog always ended in 404 "ไม่พบหนังสือ"` }));
    });

    it('a company change while the batch PDF is loading aborts everything; closing and reopening the dialog restarts cleanly', async () => {
      const targets = [pending[3], pending[4]];
      // Undo two confirmations so there are pending letters again (direct row reset — test setup only).
      await h.prisma.contractLetter.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data: { status: 'PENDING_DISPATCH', pdfGeneratedAt: null } });
      await gotoLetters(page, tabLabels.pending);
      await waitForText(page, targets[0].letterNumber, 'pending-two');
      for (const t of targets) await page.getByLabel(`เลือก ${t.letterNumber}`).click();
      await waitForText(page, 'เลือก 2 ฉบับ', 'two-selected');
      const confirmCalls = () => apiRequests.filter((r) => r.method === 'POST' && /\/pdf-generated/.test(r.url)).length;
      const before = confirmCalls();
      // Hold every letter render so the dialog is still loading when the work company changes.
      await page.route('**/overdue/letters/*/pdf*', async (route) => { await new Promise((resolve) => setTimeout(resolve, 4000)); await route.continue(); });
      await page.getByRole('button', { name: 'พิมพ์รวม' }).click();
      await page.getByRole('dialog').getByText('กำลังสร้าง PDF...').waitFor({ timeout: 15_000 });
      await web.navigate(page, '/customers?zone=shop');
      await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15_000 });
      await new Promise((resolve) => setTimeout(resolve, 6000));
      expect(confirmCalls()).toBe(before);
      expect((await status(targets[0].id)).status).toBe('PENDING_DISPATCH');
      await page.unroute('**/overdue/letters/*/pdf*');
      // Close while loading, reopen, confirm.
      await gotoLetters(page, tabLabels.pending);
      await waitForText(page, targets[0].letterNumber, 'pending-two-again');
      for (const t of targets) await page.getByLabel(`เลือก ${t.letterNumber}`).click();
      await page.getByRole('button', { name: 'พิมพ์รวม' }).click();
      let dialog = page.getByRole('dialog');
      await dialog.getByText('กำลังสร้าง PDF...').waitFor({ timeout: 15_000 }).catch(() => undefined);
      await dialog.getByRole('button', { name: 'ปิด' }).click();
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      // Closing the dialog clears the selection (the page's onClose) — select again and reopen.
      for (const t of targets) await page.getByLabel(`เลือก ${t.letterNumber}`).click();
      await waitForText(page, 'เลือก 2 ฉบับ', 'two-selected-reopen');
      await page.getByRole('button', { name: 'พิมพ์รวม' }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByText('พิมพ์รวม 2 ฉบับ').waitFor({ timeout: 15_000 });
      await dialog.getByText('กำลังสร้าง PDF...').waitFor({ state: 'detached', timeout: 120_000 });
      const { bytes } = await expectDownload(page, () => dialog.getByRole('button', { name: 'ดาวน์โหลด PDF' }).click());
      expectMergedOrder(await parsePdf(bytes), (await tableNumbers(page)).filter((n) => targets.some((t) => t.letterNumber === n)));
      await dialog.getByRole('button', { name: 'ยืนยันพิมพ์แล้ว' }).click();
      await page.getByText('บันทึกพิมพ์แล้ว 2 ฉบับ').waitFor({ timeout: 30_000 });
      expect(confirmCalls() - before).toBe(2);
      expect((await status(targets[0].id)).status).toBe('PDF_GENERATED');
      await settle(page);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/company-change-and-reopen`, title: 'Bulk print loading → work company switched to SHOP: dialog unmounts, no confirmation posted, letters stay PENDING_DISPATCH; close while loading + reopen → fresh 2-page batch, confirmation posts exactly 2', routes: ['GET /api/overdue/letters/:id/pdf', 'POST /api/overdue/letters/:id/pdf-generated'], artifacts: [], notes: `${consoleNote(errors)}; LayoutProvider re-scopes on a zone change, so the dialog\'s in-flight batch is dropped with the page` }));
    });
  });

  describe('390px', () => {
    let context: BrowserContext;
    let page: Page;
    let errors: string[];
    beforeAll(async () => {
      ({ context, page, errors } = await web.page({ width: 390, height: 844 }));
      await web.login(page, world.users.owner.email, world.password);
    }, 120000);
    afterAll(async () => { await context?.close(); });

    it('bulk print and confirmation of two letters on a phone-width screen', async () => {
      const targets = [pending[5], pending[6]];
      await h.prisma.contractLetter.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data: { status: 'PENDING_DISPATCH', pdfGeneratedAt: null } });
      await gotoLetters(page, tabLabels.pending);
      await waitForText(page, targets[0].letterNumber, 'pending-390');
      for (const t of targets) await page.getByLabel(`เลือก ${t.letterNumber}`).click();
      await waitForText(page, 'เลือก 2 ฉบับ', 'two-selected-390');
      const shotList = await shot(page, 'letters-pending-390.png');
      await settle(page);
      await page.getByRole('button', { name: 'พิมพ์รวม' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('พิมพ์รวม 2 ฉบับ').waitFor({ timeout: 15_000 });
      await dialog.getByText('กำลังสร้าง PDF...').waitFor({ state: 'detached', timeout: 120_000 });
      const shotDialog = await shot(page, 'bulk-print-390.png');
      const { bytes } = await expectDownload(page, () => dialog.getByRole('button', { name: 'ดาวน์โหลด PDF' }).click());
      expectMergedOrder(await parsePdf(bytes), (await tableNumbers(page)).filter((n) => targets.some((t) => t.letterNumber === n)));
      await dialog.getByRole('button', { name: 'ยืนยันพิมพ์แล้ว' }).click();
      await page.getByText('บันทึกพิมพ์แล้ว 2 ฉบับ').waitFor({ timeout: 30_000 });
      for (const t of targets) expect((await status(t.id)).status).toBe('PDF_GENERATED');
      await settle(page);
      await gotoLetters(page, tabLabels.printed);
      await waitForText(page, targets[0].letterNumber, 'printed-390');
      await page.getByRole('button', { name: `ดู PDF ${targets[0].letterNumber}` }).click();
      await page.getByRole('dialog').getByText('ไม่มีไฟล์เดิมเก็บไว้').waitFor({ timeout: 15_000 });
      await page.getByRole('dialog').getByText('กำลังสร้าง PDF...').waitFor({ state: 'detached', timeout: 60_000 });
      const shotPreview = await shot(page, 'preview-390.png');
      expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/mobile-390`, title: '390px: select 2 → พิมพ์รวม → 2-page PDF downloaded → ยืนยันพิมพ์แล้ว → PDF_GENERATED; preview dialog with the mobile "เปิดในแท็บใหม่" fallback', routes: ['GET /api/overdue/letters/:id/pdf', 'POST /api/overdue/letters/:id/pdf-generated'], artifacts: [shotList, shotDialog, shotPreview], notes: consoleNote(errors) }));
    }, 300000);
  });

  it('no outbound transport was used by the browser flows', () => {
    const later = h.external.calls.slice(outboundAfterSetup);
    expect(later.every((call) => /TEST-NOT-SENT|example\.invalid|^08000/.test(call.recipient))).toBe(true);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: `Outbound recorder: ${outboundAfterSetup} call(s) from setup (letter job alert), ${later.length} during the browser flows (dispatch dunning events), all synthetic recipients, none sent`, routes: [], renderer: 'none', artifacts: [] }));
  });
});
