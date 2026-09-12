import request from 'supertest';
import { DOCUMENT_STYLE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { setSystemConfig } from './support/letters-fixtures';
import { bangkokDate, bangkokEndOfDay, bangkokMidnight, CollectionsReportSeed, databaseClock, expectedRecovery, RECOVERY_CHANNELS, seedCollectionsReport } from './support/collections-report-fixtures';
import { expectReportBaseline, expectReportMatchesSource as matchSource, ParsedReport, parseReport } from './support/collections-report-pdf';
import { recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { parsePdf, ParsedPdf, sizesOfText, textSizes } from './support/pdf';

/**
 * DOC-10 (issue #1569): the collections analytics report end to end on the real
 * stack — a picked period → POST /reporting/pdf through the real guards → the
 * analytics services aggregate this run's database → jsPDF renders A4 pages.
 * Every figure on the PDF is compared with an independent restatement computed
 * from the rows (support/collections-report-fixtures.ts), never with the services.
 */
const DOMAIN = 'collections-report';
const GUARDS = ['CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard (OWNER, FINANCE_MANAGER)', 'ExportEnabledGuard (SystemConfig export_enabled)', 'EntityScopeInterceptor', 'AuditInterceptor'];
const SIMULATED = [
  'collections activity seeded directly as rows (contracts OVERDUE/DEFAULT/TERMINATED, dunning actions, promises, dispatched letters, paid installments) — the crons that normally produce them are out of scope',
  'LINE/SMS/e-mail transports recorded, never sent; the weekly report e-mail (PdfReportWeeklyCron) is never invoked and has no recipients',
  'private local storage instead of GCS/S3 (the report is streamed, nothing is stored)',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['COLLECTIONS_REPORT'], guards: GUARDS, renderer: 'jspdf', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

describe('DOC-10 collections report — real guards, real aggregation, jsPDF pages checked against independent counts', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let seed: CollectionsReportSeed;
  let owner: Session;
  let financeManager: Session;
  let accountant: Session;
  let branchManagerA: Session;
  let salesA: Session;
  let outboundAfterSetup = 0;

  const c = (session: Session | null, company: 'SHOP' | 'FINANCE' | null = 'FINANCE') => h.client({ session, company });
  const query = (from?: Date, to?: Date) => { const params = new URLSearchParams(); if (from) params.set('from', from.toISOString()); if (to) params.set('to', to.toISOString()); return params.toString() ? `?${params}` : ''; };
  const generate = async (session: Session | null, from?: Date, to?: Date, status = 201): Promise<request.Response> => {
    const response = await c(session).post(`/reporting/pdf${query(from, to)}`);
    if (response.status !== status) throw new Error(`POST /reporting/pdf${query(from, to)} → ${response.status} (expected ${status}) ${JSON.stringify(response.body).slice(0, 400)}`);
    return response;
  };
  const parsedReport = async (response: request.Response) => { const bytes = bodyBuffer(response); const pdf = await parsePdf(bytes); return { bytes, pdf, report: parseReport(pdf) }; };
  const withoutGenerated = (pdf: ParsedPdf) => pdf.pages.map((p) => p.lines.filter((line) => !line.startsWith('Generated:'))).flat();
  const baseline = (pdf: ParsedPdf, report: ParsedReport) => {
    expectReportBaseline(pdf, report);
    expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
    expect(sizesOfText(pdf, 'Aging bucket')).toEqual([DOCUMENT_STYLE.bodyPt]);
  };
  const pdfSummary = (pdf: ParsedPdf, report: ParsedReport) => ({ pageCount: pdf.pageCount, fonts: pdf.fonts, sizes: textSizes(pdf).slice(0, 6), period: report.period, kpi: report.kpi, sections: Object.fromEntries(Object.entries(report.sections).map(([k, s]) => [k, { head: s.head, headPages: s.headPages, rows: s.rows }])), pages: pdf.pages.map((p) => ({ w: p.widthPt.toFixed(2), h: p.heightPt.toFixed(2), lines: p.lines })) });

  const expectReportMatchesSource = (report: ParsedReport, from: Date, to: Date, generatedAt: Date) => matchSource(h.prisma, report, from, to, generatedAt);

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    [owner, financeManager, accountant, branchManagerA, salesA] = await Promise.all(
      [world.users.owner, world.users.financeManager, world.users.accountant, world.users.branchManagerA, world.users.salesA].map((u) => h.login(u.email, u.password)),
    );
    await setSystemConfig(h.prisma, 'export_enabled', 'true');
    await setSystemConfig(h.prisma, 'pdf_report_recipients', null);
    seed = await seedCollectionsReport(h.prisma, world);
    outboundAfterSetup = h.external.calls.length;
  }, 300000);

  afterAll(async () => { await h?.close(); });

  it('the picked period → PDF: header dates are Bangkok calendar days, KPI strip / aging / collectors / recovery / letters / promises / follow-up all equal the independent restatement', async () => {
    const { from, to } = seed.period;
    // The period starts at Bangkok midnight = 17:00 UTC the day before: a UTC-formatted header would print the wrong day.
    expect(from.toISOString().slice(0, 10)).not.toBe(bangkokDate(from));
    const generatedAt = new Date();
    const response = await generate(owner, from, to);
    expect(response.headers['content-type']).toMatch(/^application\/pdf/);
    expect(response.headers['content-disposition']).toBe(`attachment; filename="collections-${bangkokDate(to)}.pdf"`);
    const { bytes, pdf, report } = await parsedReport(response);
    baseline(pdf, report);
    const artifacts = [saveArtifact(DOMAIN, 'report-30d.pdf', bytes).relativePath, saveArtifact(DOMAIN, 'report-30d.json', JSON.stringify(pdfSummary(pdf, report), null, 2)).relativePath];
    const source = await expectReportMatchesSource(report, from, to, generatedAt);
    expect(source.range).toBe('30d');
    // This world's own rows are in those figures (they may sit next to other worlds' rows in a full run).
    const line = source.recovery.find((r) => r.channel === 'LINE')!;
    expect(line.sent).toBeGreaterThanOrEqual(seed.actions.filter((a) => a.channel === 'LINE' && a.counted).length);
    expect(source.letters.some((r) => r.type === 'CONTRACT_TERMINATION_60D')).toBe(true);
    expect(source.stuck.filter((r) => seed.stuckLabels.some((label) => r.contractNumber === seed.contracts[label].contractNumber)).length).toBe(seed.stuckLabels.length);
    expect(source.aging.every((r) => r.count >= 1)).toBe(true);
    artifacts.push(saveArtifact(DOMAIN, 'report-30d-source.json', JSON.stringify({ from, to, ...source }, null, 2)).relativePath);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/period-to-pdf`, title: `POST /reporting/pdf for ${bangkokDate(from)} … ${bangkokDate(to)} (Bangkok days): ${pdf.pageCount}-page A4 report, THSarabunPSK 16/18/12 pt, header dates = Bangkok calendar days, filename = period end; KPI strip, aging (5 buckets), collectors (top 10), recovery (4 channels), letters, promises, follow-up (top 20) all equal an independent restatement from the rows`, routes: ['POST /api/reporting/pdf'], artifacts, notes: `Defect fixed in this issue: the report read fields no analytics service returns (contractsHandled / amountCollected / sent / rate / daysStuck / status) and printed 0 or "-" for Contracts, Collected, Sent, Rate, Days stuck and Status; the header and filename printed the UTC date of the period (one day early for any range starting at Bangkok midnight). Observation: the period only drives the Recovery section — trends, aging, collectors and follow-up use a 30d/90d window ending today whatever dates are picked (same as the analytics tab); Aging/Collectors/trend figures are cached for 5 minutes in the API process. Observation: the follow-up table prints the first 20 stuck contracts with no "and N more" line while the KPI strip counts all ${source.stuck.length}` }));
  });

  it('period edges are inclusive to the millisecond for recovery: executed at from / at to count, one second outside does not; a payment on day 7 counts, an hour later does not', async () => {
    const { from, to } = seed.period;
    const full = await expectedRecovery(h.prisma, from, to);
    const inside = await expectedRecovery(h.prisma, new Date(from.getTime() + 1), new Date(to.getTime() - 1));
    const line = (rows: typeof full) => rows.find((r) => r.channel === 'LINE')!;
    // The actions executed exactly at from / at to are the only difference between the picked period and the same
    // period trimmed by 1 ms — this world seeds two of them; another world in the same run may seed its own pair.
    const edgeActions = await h.prisma.dunningAction.count({ where: { deletedAt: null, channel: 'LINE', status: { in: ['SENT', 'DELIVERED'] }, executedAt: { in: [from, to] } } });
    expect(edgeActions).toBeGreaterThanOrEqual(2);
    expect(line(full).sent - line(inside).sent).toBe(edgeActions);
    const counted = seed.actions.filter((a) => a.counted);
    const byChannel = (channel: string) => counted.filter((a) => (a.channel === 'CALL_TASK' ? 'CALL' : a.channel) === channel);
    for (const channel of RECOVERY_CHANNELS) {
      const row = full.find((r) => r.channel === channel)!;
      expect(row.sent).toBeGreaterThanOrEqual(byChannel(channel).length);
      expect(row.recovered).toBeGreaterThanOrEqual(byChannel(channel).filter((a) => a.recovered).length);
    }
    // Through the API: the trimmed period must print exactly the trimmed figures.
    const [wide, narrow] = await Promise.all([generate(owner, from, to), generate(owner, new Date(from.getTime() + 1), new Date(to.getTime() - 1))]);
    const wideReport = parseReport(await parsePdf(bodyBuffer(wide)));
    const narrowReport = parseReport(await parsePdf(bodyBuffer(narrow)));
    expect(wideReport.sections.recovery?.rows.map((r) => r.cells)).toEqual(full.map((r) => [r.channel, String(r.sent), String(r.recovered), r.rate]));
    expect(narrowReport.sections.recovery?.rows.map((r) => r.cells)).toEqual(inside.map((r) => [r.channel, String(r.sent), String(r.recovered), r.rate]));
    expect(narrowReport.period).toEqual(wideReport.period);
    // Bangkok day boundaries as the web sends them (startOfDay / endOfDay in Asia/Bangkok) land on the same calendar dates in the header.
    expect(wideReport.period).toEqual({ from: bangkokDate(from), to: bangkokDate(to) });
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/period-edges`, title: `Recovery counts dunning actions executed inside [from, to] inclusive: the same period trimmed by 1 ms loses exactly the ${edgeActions} action(s) executed at its edges (LINE ${line(full).sent} → ${line(inside).sent}); an action before from / after to never counts; a payment exactly 7 days after execution is recovered, +1 h is not; FAILED/PENDING actions are ignored`, routes: ['POST /api/reporting/pdf'], artifacts: [saveArtifact(DOMAIN, 'recovery-edges.json', JSON.stringify({ from, to, full, inside, seededActions: seed.actions }, null, 2)).relativePath], notes: `Database session timezone: ${(await databaseClock(h.prisma)).timezone} (production Cloud SQL runs UTC; the runner now pins the disposable PostgreSQL to UTC — under an Asia/Bangkok session every timestamp-vs-NOW() window in the analytics SQL shifts by 7 hours)` }));
  });

  it('a wider period switches the trend window to 90 days and spans several pages: table heads repeat on every continued page, rows never split, page numbers and header on every page', async () => {
    const from = bangkokMidnight(80);
    const to = bangkokEndOfDay(3);
    const generatedAt = new Date();
    const { bytes, pdf, report } = await parsedReport(await generate(owner, from, to));
    baseline(pdf, report);
    const artifacts = [saveArtifact(DOMAIN, 'report-90d.pdf', bytes).relativePath, saveArtifact(DOMAIN, 'report-90d.json', JSON.stringify(pdfSummary(pdf, report), null, 2)).relativePath];
    const source = await expectReportMatchesSource(report, from, to, generatedAt);
    expect(source.range).toBe('90d');
    // The 35-day-old letter is inside the 90-day window and outside the 30-day one.
    const oldLetter = seed.letters.find((l) => l.label === 'L45-35D')!;
    expect(source.letters.some((r) => r.month === oldLetter.dispatchedAt.toISOString().slice(0, 7) && r.type === 'RETURN_DEVICE_45D')).toBe(true);
    expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
    // A section that continues on a later page repeats its head there; every row has all its cells on one page.
    for (const [key, section] of Object.entries(report.sections)) {
      const pages = [...new Set(section.rows.map((r) => r.page))];
      for (const page of pages) expect({ section: key, page, headOnPage: section.headPages.includes(page) }).toEqual({ section: key, page, headOnPage: true });
      for (const row of section.rows) expect({ section: key, row: row.cells, complete: row.cells.every((cell) => cell.length > 0) }).toEqual({ section: key, row: row.cells, complete: true });
    }
    const continued = Object.entries(report.sections).filter(([, s]) => new Set(s.rows.map((r) => r.page)).size > 1).map(([k]) => k);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/multi-page-90d`, title: `${bangkokDate(from)} … ${bangkokDate(to)} (77 days → 90-day trend window): ${pdf.pageCount} A4 pages, header + "n / ${pdf.pageCount}" on every page, sections continued across pages ${continued.length ? `(${continued.join(', ')})` : '(none)'} repeat their head row, no row split, figures equal the independent restatement; the 35-day-old letter appears only in this window`, routes: ['POST /api/reporting/pdf'], artifacts, notes: `sections: ${Object.entries(report.sections).map(([k, s]) => `${k} ${s.rows.length} rows on p.${[...new Set(s.rows.map((r) => r.page))].join('/')}`).join(', ')}` }));
  });

  it('an empty period prints zero recovery rows and the same global sections; no dates = the last 7 days; invalid or inverted dates are rejected', async () => {
    const from = new Date('2020-01-01T00:00:00+07:00');
    const to = new Date('2020-01-08T23:59:59.999+07:00');
    const generatedAt = new Date();
    const { bytes, pdf, report } = await parsedReport(await generate(owner, from, to));
    baseline(pdf, report);
    const artifacts = [saveArtifact(DOMAIN, 'report-empty-2020.pdf', bytes).relativePath, saveArtifact(DOMAIN, 'report-empty-2020.json', JSON.stringify(pdfSummary(pdf, report), null, 2)).relativePath];
    const source = await expectReportMatchesSource(report, from, to, generatedAt);
    expect(source.recovery.every((r) => r.sent === 0 && r.recovered === 0)).toBe(true);
    expect(report.sections.recovery?.rows.map((r) => r.cells)).toEqual(RECOVERY_CHANNELS.map((channel) => [channel, '0', '0', '0%']));
    // Default period: the last 7 days ending now.
    const defaulted = parseReport(await parsePdf(bodyBuffer(await generate(owner))));
    const now = new Date();
    expect(defaulted.period).toEqual({ from: bangkokDate(new Date(now.getTime() - 7 * 86_400_000)), to: bangkokDate(now) });
    const inverted = await generate(owner, to, from, 400);
    expect(inverted.body.message).toBe('from ต้องมาก่อน to');
    const equal = await generate(owner, from, from, 400);
    expect(equal.body.message).toBe('from ต้องมาก่อน to');
    const malformed = await c(owner).post('/reporting/pdf?from=2026-13-45&to=yesterday');
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(malformed.body)).toContain('รูปแบบวันที่ไม่ถูกต้อง');
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/empty-default-invalid`, title: `2020-01-01 … 2020-01-08: recovery = 4 channels at 0 / 0 / 0%, header shows 2020, the global sections (aging, collectors, trends, follow-up) still print today's window; no dates → last 7 days (${defaulted.period?.from} … ${defaulted.period?.to}); from ≥ to → 400 "from ต้องมาก่อน to"; malformed dates → 400 "รูปแบบวันที่ไม่ถูกต้อง"`, routes: ['POST /api/reporting/pdf'], artifacts, notes: 'Observation: an "empty" report never exists — only the Recovery section follows the picked period; everything else is a snapshot of the last 30/90 days' }));
  });

  it('guards: OWNER and FINANCE_MANAGER export, ACCOUNTANT / BRANCH_MANAGER / SALES get 403, no token 401, export_enabled=false → 403 with an EXPORT_BLOCKED audit row, GET is not a route', async () => {
    const { from, to } = seed.period;
    await generate(financeManager, from, to, 201);
    await generate(accountant, from, to, 403);
    // Branch roles hold SHOP access only — the request is scoped to SHOP, the role gate still refuses.
    const bm = await c(branchManagerA, 'SHOP').post(`/reporting/pdf${query(from, to)}`);
    expect(bm.status).toBe(403);
    const sales = await c(salesA, 'SHOP').post(`/reporting/pdf${query(from, to)}`);
    expect(sales.status).toBe(403);
    expect((await c(null, 'FINANCE').post(`/reporting/pdf${query(from, to)}`)).status).toBe(401);
    expect((await h.client({ token: `${owner.token.slice(0, -4)}xxxx`, company: 'FINANCE' }).post(`/reporting/pdf${query(from, to)}`)).status).toBe(401);
    expect((await c(owner).get(`/reporting/pdf${query(from, to)}`)).status).toBe(404);
    // The report is not company-scoped: the SHOP work zone answers the same document.
    const shopScoped = await c(owner, 'SHOP').post(`/reporting/pdf${query(from, to)}`);
    expect(shopScoped.status).toBe(201);
    // Kill switch.
    const blockedBefore = await h.prisma.auditLog.count({ where: { action: 'EXPORT_BLOCKED', userId: owner.user.id } });
    await setSystemConfig(h.prisma, 'export_enabled', 'false');
    const blocked = await generate(owner, from, to, 403);
    expect(blocked.body.message).toBe('การส่งออกข้อมูลถูกปิดใช้งานชั่วคราว — โปรดติดต่อผู้ดูแลระบบ');
    const audit = await h.prisma.auditLog.findMany({ where: { action: 'EXPORT_BLOCKED', userId: owner.user.id }, orderBy: { createdAt: 'desc' }, take: 1 });
    expect(await h.prisma.auditLog.count({ where: { action: 'EXPORT_BLOCKED', userId: owner.user.id } })).toBe(blockedBefore + 1);
    expect(audit[0]).toMatchObject({ entity: 'system_config', entityId: 'export_enabled' });
    expect((audit[0].newValue as { route: string; reason: string }).reason).toBe('export_enabled=false');
    await setSystemConfig(h.prisma, 'export_enabled', 'true');
    await generate(owner, from, to, 201);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/guards`, title: 'OWNER 201, FINANCE_MANAGER 201, ACCOUNTANT 403, BRANCH_MANAGER 403, SALES 403, no token 401, tampered token 401, GET 404; export_enabled=false → 403 "การส่งออกข้อมูลถูกปิดใช้งานชั่วคราว …" + one EXPORT_BLOCKED audit row (system_config/export_enabled), re-enabled → 201', routes: ['POST /api/reporting/pdf', 'GET /api/reporting/pdf'], renderer: 'none', artifacts: [], notes: 'Observation: the route is not entity-scoped — ?company=shop returns the same report; the web only shows the export button to OWNER although FINANCE_MANAGER may call the route' }));
  });

  it('the same period rendered twice or three times at once gives the same document (only the Generated timestamp differs); nothing leaves the system', async () => {
    const { from, to } = seed.period;
    const responses = await Promise.all([generate(owner, from, to), generate(owner, from, to), generate(owner, from, to)]);
    const docs = await Promise.all(responses.map((r) => parsePdf(bodyBuffer(r))));
    const [first, ...rest] = docs.map(withoutGenerated);
    for (const lines of rest) expect(lines).toEqual(first);
    expect(docs.every((d) => d.pages.some((p) => p.lines.some((l) => l.startsWith('Generated:'))))).toBe(true);
    expect(h.external.calls.length).toBe(outboundAfterSetup);
    expect(await h.prisma.systemConfig.findFirst({ where: { key: 'pdf_report_recipients', deletedAt: null } })).toBeNull();
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/repeat-and-no-outbound`, title: '3 concurrent exports of the same period → 3 × 201 with identical pages apart from the Generated timestamp; no LINE/SMS/e-mail left the process during the whole spec; weekly recipients unset so the weekly e-mail job would skip (never invoked here)', routes: ['POST /api/reporting/pdf'], renderer: 'jspdf', artifacts: [], unverified: ['the Monday 08:00 weekly e-mail (PdfReportWeeklyCron) — not triggered, recipients management not exercised'], notes: `outbound calls recorded during the spec: ${h.external.calls.length - outboundAfterSetup}` }));
  });
});
