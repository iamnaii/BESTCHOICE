import { join } from 'path';
import type { BrowserContext, Page } from '@playwright/test';
import { DocumentsHarness, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { setSystemConfig } from './support/letters-fixtures';
import { bangkokDate, bangkokEndOfDay, bangkokMidnight, CollectionsReportSeed, seedCollectionsReport } from './support/collections-report-fixtures';
import { expectReportBaseline, expectReportMatchesSource, parseReport } from './support/collections-report-pdf';
import { downloadBytes, startWeb, WebRuntime } from './support/web';
import { domainDir, recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { parsePdf } from './support/pdf';

/**
 * DOC-10 browser evidence (issue #1569): the live /collections analytics tab against
 * this run's API — pick a period, export, and what cancel / close-and-reopen /
 * double click / a failed attempt / a company change do to the in-flight export.
 */
const DOMAIN = 'collections-report-browser';
const GUARDS = ['real login form → POST /api/auth/login', 'JwtAuthGuard', 'RolesGuard (OWNER, FINANCE_MANAGER)', 'ExportEnabledGuard', 'EntityScopeInterceptor (?company= from the work zone)', 'web: analytics tab OWNER/FINANCE_MANAGER, export button OWNER + export_enabled'];
const SIMULATED = [
  'collections activity seeded directly as rows (contracts OVERDUE/DEFAULT/TERMINATED, dunning actions, promises, dispatched letters, paid installments)',
  'report latency / one failed attempt scripted by Playwright routes on POST /api/admin/reporting/pdf; the server still renders every request it receives',
  'LINE/SMS/e-mail transports recorded, never sent; private local storage; the weekly report e-mail is never invoked',
  'web served by the Vite dev server (same source as the production bundle); one real login per viewport, in-app routing afterwards',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['COLLECTIONS_REPORT'], guards: GUARDS, renderer: 'jspdf', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});
const REPORT_ROUTE = '**/reporting/pdf*';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** DD/MM/พ.ศ. as the date-range button shows a Bangkok calendar day. */
const thaiShortDate = (at: Date) => { const [y, m, d] = bangkokDate(at).split('-'); return `${d}/${m}/${Number(y) + 543}`; };

describe('DOC-10 browser evidence — /collections analytics export: period, download, cancel, reopen, retry, company change', () => {
  let h: DocumentsHarness;
  let web: WebRuntime;
  let world: DocumentsWorld;
  let seed: CollectionsReportSeed;
  let outboundAfterSetup = 0;
  const reportRequests: Array<{ url: string; company: string | null; from: string | null; to: string | null; status?: number; at: string }> = [];

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
    await sleep(ms);
    page.off('download', listener);
    return !seen;
  };
  const toasts = (page: Page) => page.locator('[data-sonner-toast]').allInnerTexts();
  const trackReports = (page: Page) => {
    page.on('request', (request) => {
      if (!/\/reporting\/pdf/.test(request.url())) return;
      const url = new URL(request.url());
      reportRequests.push({ url: url.pathname + url.search, company: url.searchParams.get('company'), from: url.searchParams.get('from'), to: url.searchParams.get('to'), at: new Date().toISOString() });
    });
    page.on('response', (response) => {
      if (!/\/reporting\/pdf/.test(response.url())) return;
      const entry = [...reportRequests].reverse().find((r) => r.status === undefined);
      if (entry) entry.status = response.status();
    });
  };
  /** The analytics tab of /collections (Library view) with its export button, closing a stray dialog first. */
  /** The export dialog by its title — the page always holds an off-screen <aside role="dialog"> (customer 360 panel) too. */
  const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'ส่งออกรายงาน PDF' });
  const closeStrayDialog = async (page: Page) => {
    if (await exportDialog(page).count()) { await page.keyboard.press('Escape'); await exportDialog(page).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined); }
  };
  const gotoAnalytics = async (page: Page, expectExportButton = true) => {
    await closeStrayDialog(page);
    await web.navigate(page, '/collections');
    await waitForText(page, 'ติดตามหนี้', 'collections-page');
    const tab = page.getByRole('button', { name: /^วิเคราะห์/ });
    if (!(await tab.count())) {
      const library = page.getByRole('button', { name: 'Library', exact: true });
      if (await library.count()) await library.click();
    }
    if (expectExportButton) {
      await tab.first().click();
      await page.getByRole('button', { name: 'ส่งออกรายงาน PDF' }).waitFor({ timeout: 30_000 });
    }
  };
  const openExport = async (page: Page) => {
    await closeStrayDialog(page);
    await page.getByRole('button', { name: 'ส่งออกรายงาน PDF' }).click();
    const dialog = exportDialog(page);
    await dialog.getByRole('heading', { name: 'ส่งออกรายงาน PDF' }).waitFor({ timeout: 15_000 });
    return dialog;
  };
  const delayReports = async (page: Page, ms: number) => {
    await page.route(REPORT_ROUTE, async (route) => { await sleep(ms); await route.continue().catch(() => undefined); });
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    await setSystemConfig(h.prisma, 'export_enabled', 'true');
    await setSystemConfig(h.prisma, 'pdf_report_recipients', null);
    seed = await seedCollectionsReport(h.prisma, world);
    outboundAfterSetup = h.external.calls.length;
    web = await startWeb(h);
  }, 300000);

  afterAll(async () => {
    await web?.close();
    await h?.close();
  });

  describe('1440px', () => {
    let context: BrowserContext;
    let page: Page;
    let errors: string[];
    let firstRequest: { from: Date; to: Date; company: string | null };
    beforeAll(async () => {
      ({ context, page, errors } = await web.page({ width: 1440, height: 1000 }));
      trackReports(page);
      await web.login(page, world.users.owner.email, world.password);
    }, 120000);
    afterAll(async () => { await context?.close(); });

    it('pick "30 วัน" → ดาวน์โหลด: the request carries Bangkok start/end of day, the PDF downloads with the local date in its name, its pages equal the independent restatement, the dialog closes on success', async () => {
      await gotoAnalytics(page);
      const shotTab = await shot(page, 'analytics-tab-1440.png');
      const dialog = await openExport(page);
      await dialog.getByRole('button', { name: '30 วัน', exact: true }).click();
      const shotDialog = await shot(page, 'export-dialog-1440.png');
      const generatedAt = new Date();
      const before = reportRequests.length;
      const { bytes, filename } = await expectDownload(page, () => dialog.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click());
      await waitForText(page, 'ดาวน์โหลด PDF สำเร็จ', 'download-toast');
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      expect(reportRequests.length).toBe(before + 1);
      const request = reportRequests[reportRequests.length - 1];
      const from = new Date(request.from!);
      const to = new Date(request.to!);
      // startOfDay / endOfDay in the browser's Asia/Bangkok clock, sent as UTC instants.
      expect(from.toISOString()).toBe(bangkokMidnight(29, generatedAt).toISOString());
      expect(to.toISOString()).toBe(bangkokEndOfDay(0, generatedAt).toISOString());
      expect(filename).toBe(`collections-${bangkokDate(generatedAt)}.pdf`);
      firstRequest = { from, to, company: request.company };
      const pdf = await parsePdf(bytes);
      const report = parseReport(pdf);
      expectReportBaseline(pdf, report);
      const source = await expectReportMatchesSource(h.prisma, report, from, to, generatedAt);
      await settle(page);
      const artifacts = [shotTab, shotDialog, saveArtifact(DOMAIN, 'export-30d-1440.pdf', bytes).relativePath, saveArtifact(DOMAIN, 'export-30d-1440.json', JSON.stringify({ request, filename, pageCount: pdf.pageCount, period: report.period, kpi: report.kpi, sections: report.sections, fonts: pdf.fonts }, null, 2)).relativePath];
      expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/export-30d`, title: `Analytics tab → ส่งออก PDF → "30 วัน" → ดาวน์โหลด: POST /reporting/pdf?from=${request.from}&to=${request.to} (Bangkok day boundaries), ${pdf.pageCount}-page A4 PDF saved as ${filename}, header "Period: ${report.period?.from} — ${report.period?.to}", KPI/aging/collectors/recovery/letters/promises/follow-up equal the independent restatement (${source.range} window), toast + dialog closed`, routes: ['POST /api/admin/reporting/pdf'], artifacts, notes: `${consoleNote(errors)}; request company scope = ${request.company}. Defect fixed in this issue: the client named the file with the UTC date (still "yesterday" until 07:00 Bangkok)` }));
    }, 300000);

    it('ยกเลิก while the report is loading: no file, no toast, the server request simply finishes unused', async () => {
      await delayReports(page, 5000);
      const dialog = await openExport(page);
      // The dialog keeps the period picked before.
      await dialog.getByRole('button', { name: `${thaiShortDate(firstRequest.from)} – ${thaiShortDate(firstRequest.to)}` }).waitFor({ timeout: 10_000 });
      const before = reportRequests.length;
      await dialog.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click();
      await dialog.locator('button[disabled]', { hasText: 'ดาวน์โหลด' }).waitFor({ timeout: 5_000 });
      const shotLoading = await shot(page, 'export-loading-1440.png');
      await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      expect(await noDownloadWithin(page, 7000)).toBe(true);
      expect(await toasts(page)).toEqual([]);
      expect(reportRequests.length).toBe(before + 1);
      await page.unroute(REPORT_ROUTE);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/cancel-while-loading`, title: 'ดาวน์โหลด (5 s scripted latency) → ยกเลิก: dialog closes, the aborted request produces no file and no toast; exactly 1 request was sent', routes: ['POST /api/admin/reporting/pdf'], artifacts: [shotLoading], notes: consoleNote(errors) }));
    }, 120000);

    it('close while loading then reopen: the old response never closes the new dialog; a double click sends one request', async () => {
      await delayReports(page, 4000);
      let dialog = await openExport(page);
      const before = reportRequests.length;
      await dialog.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      dialog = await openExport(page);
      await dialog.locator('button:not([disabled])', { hasText: 'ดาวน์โหลด' }).waitFor({ timeout: 5_000 });
      await sleep(6000);
      expect(await dialog.count()).toBe(1);
      expect(await toasts(page)).toEqual([]);
      expect(reportRequests.length).toBe(before + 1);
      await page.unroute(REPORT_ROUTE);
      const { bytes } = await expectDownload(page, () => dialog.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).dblclick());
      await waitForText(page, 'ดาวน์โหลด PDF สำเร็จ', 'download-toast-reopen');
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      expect(reportRequests.length).toBe(before + 2);
      expect((await parsePdf(bytes)).pageCount).toBeGreaterThanOrEqual(1);
      await settle(page);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/reopen-and-double-click`, title: 'ดาวน์โหลด → Esc (abort) → reopen: 6 s later (past the old response) the new dialog is still open with no toast and no file; double click on ดาวน์โหลด → 1 request, 1 download, dialog closes', routes: ['POST /api/admin/reporting/pdf'], artifacts: [], notes: consoleNote(errors) }));
    }, 120000);

    it('a failed attempt shows the server message and keeps the period; the retry sends the same from/to and succeeds', async () => {
      await page.route(REPORT_ROUTE, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'ทดสอบระบบ: สร้างรายงานไม่สำเร็จชั่วคราว' }) }), { times: 1 });
      const dialog = await openExport(page);
      const before = reportRequests.length;
      await dialog.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click();
      await waitForText(page, 'สร้างรายงานไม่สำเร็จชั่วคราว', 'error-toast');
      const shotError = await shot(page, 'export-error-1440.png');
      expect(await dialog.count()).toBe(1);
      await dialog.getByRole('button', { name: `${thaiShortDate(firstRequest.from)} – ${thaiShortDate(firstRequest.to)}` }).waitFor({ timeout: 10_000 });
      await settle(page);
      await expectDownload(page, () => dialog.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click());
      await waitForText(page, 'ดาวน์โหลด PDF สำเร็จ', 'download-toast-retry');
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      const [failed, retried] = reportRequests.slice(before);
      expect(reportRequests.length).toBe(before + 2);
      expect({ from: retried.from, to: retried.to }).toEqual({ from: failed.from, to: failed.to });
      expect(failed.status).toBe(500);
      expect(retried.status).toBe(201);
      await settle(page);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/retry-keeps-period`, title: 'First attempt answered 500 (scripted) → toast shows the server message, dialog stays open with the same period → ดาวน์โหลด again → identical from/to, 201, file downloaded', routes: ['POST /api/admin/reporting/pdf'], artifacts: [shotError], notes: consoleNote(errors) }));
    }, 120000);

    it('a work-company change while the report is loading drops the export with the page: no file, no toast', async () => {
      await delayReports(page, 5000);
      const dialog = await openExport(page);
      const before = reportRequests.length;
      await dialog.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click();
      const otherZone = firstRequest.company === 'shop' ? 'fin' : 'shop';
      await web.navigate(page, `/customers?zone=${otherZone}`);
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      expect(await noDownloadWithin(page, 7000)).toBe(true);
      expect(await toasts(page)).toEqual([]);
      expect(reportRequests.length).toBe(before + 1);
      await page.unroute(REPORT_ROUTE);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/company-change`, title: `ดาวน์โหลด (5 s latency) → work zone switched to ${otherZone === 'shop' ? 'SHOP' : 'FINANCE'} mid-flight: the analytics page unmounts with its dialog, no file, no toast`, routes: ['POST /api/admin/reporting/pdf'], artifacts: [], notes: `${consoleNote(errors)}; the request was sent with company=${firstRequest.company}` }));
    }, 120000);

    it('export_enabled=false hides the export button (the API also answers 403); re-enabled it returns', async () => {
      await setSystemConfig(h.prisma, 'export_enabled', 'false');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await gotoAnalytics(page, false);
      await page.getByRole('button', { name: /^วิเคราะห์/ }).first().click();
      await waitForText(page, 'อัตราการเก็บเงินรายสัปดาห์', 'analytics-without-export');
      expect(await page.getByRole('button', { name: 'ส่งออกรายงาน PDF' }).count()).toBe(0);
      const shotHidden = await shot(page, 'export-disabled-1440.png');
      const api = h.client({ session: await h.login(world.users.owner.email, world.password), company: 'FINANCE' });
      expect((await api.post('/reporting/pdf')).status).toBe(403);
      await setSystemConfig(h.prisma, 'export_enabled', 'true');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await gotoAnalytics(page);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/export-disabled`, title: 'SystemConfig export_enabled=false → the analytics tab shows no export button (POST /reporting/pdf answers 403 for the same user); set back to true → button visible again', routes: ['GET /api/admin/settings/ui-flags', 'POST /api/reporting/pdf'], renderer: 'none', artifacts: [shotHidden], notes: `${consoleNote(errors)}. Defect fixed in this issue: the button ignored the flag and only learned about it from the 403` }));
    }, 120000);
  });

  describe('other roles at 1440px', () => {
    it('FINANCE_MANAGER sees the analytics tab without the export button; SALES has no analytics tab', async () => {
      const fm = await web.page({ width: 1440, height: 1000 });
      try {
        await web.login(fm.page, world.users.financeManager.email, world.password);
        await gotoAnalytics(fm.page, false);
        await fm.page.getByRole('button', { name: /^วิเคราะห์/ }).first().click();
        await waitForText(fm.page, 'อัตราการเก็บเงินรายสัปดาห์', 'fm-analytics');
        expect(await fm.page.getByRole('button', { name: 'ส่งออกรายงาน PDF' }).count()).toBe(0);
        var shotFm = await shot(fm.page, 'analytics-finance-manager-1440.png');
      } finally { await fm.context.close(); }
      const sales = await web.page({ width: 1440, height: 1000 });
      try {
        await web.login(sales.page, world.users.salesA.email, world.password);
        await gotoAnalytics(sales.page, false);
        expect(await sales.page.getByRole('button', { name: /^วิเคราะห์/ }).count()).toBe(0);
        var shotSales = await shot(sales.page, 'collections-sales-1440.png');
      } finally { await sales.context.close(); }
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/roles`, title: 'FINANCE_MANAGER: analytics tab visible, no export button (the route would accept the role); SALES: no analytics tab at all', routes: [], renderer: 'none', artifacts: [shotFm, shotSales], notes: 'Observation: the export button is OWNER-only in the web while POST /reporting/pdf allows FINANCE_MANAGER — a FINANCE_MANAGER can only export through the API' }));
    }, 180000);
  });

  describe('390px', () => {
    let context: BrowserContext;
    let page: Page;
    let errors: string[];
    beforeAll(async () => {
      ({ context, page, errors } = await web.page({ width: 390, height: 844 }));
      trackReports(page);
      await web.login(page, world.users.owner.email, world.password);
    }, 120000);
    afterAll(async () => { await context?.close(); });

    it('390px: export dialog with wrapped presets → "7 วัน" → download → header period = the 7 Bangkok days', async () => {
      await gotoAnalytics(page);
      const shotTab = await shot(page, 'analytics-tab-390.png');
      const dialog = await openExport(page);
      await dialog.getByRole('button', { name: '7 วัน', exact: true }).click();
      const shotDialog = await shot(page, 'export-dialog-390.png');
      const generatedAt = new Date();
      const before = reportRequests.length;
      const { bytes } = await expectDownload(page, () => dialog.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click());
      await waitForText(page, 'ดาวน์โหลด PDF สำเร็จ', 'download-toast-390');
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      const request = reportRequests[reportRequests.length - 1];
      expect(reportRequests.length).toBe(before + 1);
      const pdf = await parsePdf(bytes);
      const report = parseReport(pdf);
      expectReportBaseline(pdf, report);
      expect(report.period).toEqual({ from: bangkokDate(bangkokMidnight(6, generatedAt)), to: bangkokDate(generatedAt) });
      await expectReportMatchesSource(h.prisma, report, new Date(request.from!), new Date(request.to!), generatedAt);
      await settle(page);
      expect(h.external.calls.length).toBe(outboundAfterSetup);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/mobile-390`, title: `390px: ส่งออก PDF → "7 วัน" → ดาวน์โหลด → ${pdf.pageCount}-page report for ${report.period?.from} … ${report.period?.to}, figures equal the restatement; no outbound message during the whole spec`, routes: ['POST /api/admin/reporting/pdf'], artifacts: [shotTab, shotDialog, saveArtifact(DOMAIN, 'export-7d-390.pdf', bytes).relativePath], notes: consoleNote(errors) }));
    }, 300000);
  });
});
