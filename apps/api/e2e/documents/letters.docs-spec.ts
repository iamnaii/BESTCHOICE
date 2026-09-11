import request from 'supertest';
import { DOCUMENT_STYLE } from '@installment/shared';
import { LetterAutoGenerateCron } from '../../src/modules/overdue/crons/letter-auto-generate.cron';
import { thaiBahtText } from '../../src/utils/thai-baht-text.util';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { createOverdueContract, expectedLetterFigures, letterMoney, OverdueContract, setSystemConfig, thaiLongDate } from './support/letters-fixtures';
import { recordScenario, saveArtifact, ScenarioRecord, sha256 } from './support/artifacts';
import { contentSignature, foldThai, isA4, pageContaining, pageText, parsePdf, ParsedPdf, sizesOfText, textSizes } from './support/pdf';

/**
 * DOC-09 (issue #1568): collection letters end to end on the real stack — the
 * auto-generate job creates letters from overdue contracts, the server renders
 * each letter through Chromium, branch scope is enforced by the real guard, and
 * only the explicit confirmations (print / dispatch) move a letter's status.
 */
const DOMAIN = 'letters';
const GUARDS = ['CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard', 'BranchGuard', 'LetterDocumentAccessGuard (pdf + pdf-generated)', 'ContractLetterService.list branch scope', 'EntityScopeInterceptor', 'AuditInterceptor'];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded, never sent (owner alert of the letter job, dunning events on dispatch)',
  'private local storage instead of GCS/S3',
  'contracts are seeded directly as OVERDUE with unpaid installments (the overdue-status cron is out of scope); letters themselves come from the real LetterAutoGenerateCron.run()',
  'EMS dispatch = tracking number recorded through the real route; no postal service involved',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['COLLECTION_LETTER'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

interface LetterRow { id: string; contractId: string; letterType: string; letterNumber: string; status: string; pdfUrl: string | null; pdfGeneratedAt: Date | null; dispatchedAt: Date | null; dispatchedById: string | null; trackingNumber: string | null; cancelledAt: Date | null }

describe('DOC-09 collection letters — real job, real renderer, real guards, print/dispatch confirmations', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let owner: Session;
  let financeManager: Session;
  let accountant: Session;
  let branchManagerA: Session;
  let salesA: Session;
  let salesB: Session;
  let contracts: Record<'A45' | 'A60' | 'LONG' | 'B1' | 'FRESH' | 'ACTIVE', OverdueContract>;
  const letters: Record<string, LetterRow> = {};
  let outboundAfterSetup = 0;

  const ok = async (test: request.Test, status: number, label: string): Promise<request.Response> => {
    const response = await test;
    if (response.status !== status) throw new Error(`${label} → ${response.status} (expected ${status}) ${JSON.stringify(response.body).slice(0, 400)}`);
    return response;
  };
  // Branch roles hold SHOP access only (resolveCompanyAccess) — the web sends the work company the user can use.
  const c = (session: Session | null) => h.client({ session, company: session?.user.accessibleCompanies.includes('FINANCE') ? 'FINANCE' : 'SHOP' });
  const rowsOf = (response: request.Response) => (response.body.data as { data: Array<Record<string, unknown>>; total: number }).data;
  const load = async (id: string): Promise<LetterRow> => {
    const row = await h.prisma.contractLetter.findUniqueOrThrow({ where: { id } });
    return { id: row.id, contractId: row.contractId, letterType: row.letterType, letterNumber: row.letterNumber, status: row.status, pdfUrl: row.pdfUrl, pdfGeneratedAt: row.pdfGeneratedAt, dispatchedAt: row.dispatchedAt, dispatchedById: row.dispatchedById, trackingNumber: row.trackingNumber, cancelledAt: row.cancelledAt };
  };
  const audits = async (letterId: string) => (await h.prisma.auditLog.findMany({ where: { entity: 'contract_letter', entityId: letterId }, orderBy: { createdAt: 'asc' }, select: { action: true, userId: true, newValue: true } }));
  const worldLetters = async () => h.prisma.contractLetter.findMany({ where: { contractId: { in: Object.values(contracts).map((c) => c.id) } }, orderBy: [{ contractId: 'asc' }, { letterType: 'asc' }] });
  const has = (pdf: ParsedPdf, needle: string) => foldThai(pdf.pages.map(pageText).join('\n')).includes(foldThai(needle));
  const expectAll = (pdf: ParsedPdf, needles: string[]) => { for (const needle of needles) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: true }); };
  const pdfOf = async (session: Session | null, letterId: string, status = 200) => {
    const response = await c(session).get(`/overdue/letters/${letterId}/pdf`);
    if (response.status !== status) throw new Error(`GET /overdue/letters/${letterId}/pdf → ${response.status} (expected ${status}) ${JSON.stringify(response.body).slice(0, 300)}`);
    return response;
  };
  const pdfSummary = (pdf: ParsedPdf) => ({ pageCount: pdf.pageCount, fonts: pdf.fonts, sizes: textSizes(pdf).slice(0, 6), pages: pdf.pages.map((p) => ({ w: p.widthPt.toFixed(2), h: p.heightPt.toFixed(2), lines: p.lines })) });
  const baseline = (pdf: ParsedPdf, company: { nameTh: string }) => {
    expect(pdf.pages.every(isA4)).toBe(true);
    expect(pdf.fonts.length).toBeGreaterThan(0);
    expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
    expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
    expect(sizesOfText(pdf, company.nameTh)).toContain(DOCUMENT_STYLE.headingPt);
    expect(sizesOfText(pdf, 'ขอแสดงความนับถือ')).toEqual([DOCUMENT_STYLE.bodyPt]);
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    [owner, financeManager, accountant, branchManagerA, salesA, salesB] = await Promise.all(
      [world.users.owner, world.users.financeManager, world.users.accountant, world.users.branchManagerA, world.users.salesA, world.users.salesB].map((u) => h.login(u.email, u.password)),
    );
    // The owner gets a synthetic LINE id so the job's owner alert goes through the recorded transport.
    await h.prisma.user.update({ where: { id: world.users.owner.id }, data: { lineId: `TEST-NOT-SENT-OWNER-${world.prefix}` } });
    await setSystemConfig(h.prisma, 'letter_coordinator_name', `${'ทดสอบระบบ'} ผู้ประสานงาน`);
    await setSystemConfig(h.prisma, 'letter_coordinator_phone', '02-000-0000');
    const make = (label: string, branchId: string, salespersonId: string, oldestOverdueDays: number, extra: Partial<Parameters<typeof createOverdueContract>[1]> = {}) =>
      createOverdueContract(h.prisma, { prefix: world.prefix, label, branchId, customerId: world.customer.id, salespersonId, oldestOverdueDays, ...extra });
    contracts = {
      A45: await make('A45', world.branches.a.id, world.users.salesA.id, 50),
      A60: await make('A60', world.branches.a.id, world.users.salesA.id, 75),
      LONG: await make('LONG', world.branches.a.id, world.users.salesA.id, 1000, { months: 36, productModel: `iPhone ทดสอบระบบ รุ่นชื่อยาวพิเศษสำหรับตรวจการตัดบรรทัดของจดหมายทวงถาม Pro Max Ultra Edition ${world.prefix}` }),
      B1: await make('B1', world.branches.b.id, world.users.salesB.id, 50),
      FRESH: await make('FRESH', world.branches.a.id, world.users.salesA.id, 20),
      ACTIVE: await make('ACTIVE', world.branches.a.id, world.users.salesA.id, 50, { status: 'ACTIVE' }),
    };
  }, 300000);

  afterAll(async () => { await h?.close(); });

  it('the letter job creates 45-day and 60-day letters only for OVERDUE/DEFAULT contracts past the thresholds, once, and alerts the owner through the recorded transport', async () => {
    const cron = h.app.get(LetterAutoGenerateCron);
    await setSystemConfig(h.prisma, 'letter_auto_generate_enabled', 'false');
    await cron.run();
    expect(await worldLetters()).toEqual([]);
    await setSystemConfig(h.prisma, 'letter_auto_generate_enabled', 'true');
    const created = await cron.run();
    const rows = await worldLetters();
    const byKey = (contractId: string, type: string) => rows.find((r) => r.contractId === contractId && r.letterType === type);
    expect(rows.map((r) => `${Object.entries(contracts).find(([, v]) => v.id === r.contractId)![0]}:${r.letterType}`).sort()).toEqual(
      ['A45:RETURN_DEVICE_45D', 'A60:CONTRACT_TERMINATION_60D', 'A60:RETURN_DEVICE_45D', 'B1:RETURN_DEVICE_45D', 'LONG:CONTRACT_TERMINATION_60D', 'LONG:RETURN_DEVICE_45D'],
    );
    expect(created.returnDevice).toBeGreaterThanOrEqual(4);
    expect(created.termination).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.letterNumber).toMatch(/^ST-\d{4}-\d{5}$/);
      expect(row.status).toBe('PENDING_DISPATCH');
      expect(row.pdfUrl).toBeNull();
    }
    expect(new Set(rows.map((r) => r.letterNumber)).size).toBe(rows.length);
    letters.A45 = await load(byKey(contracts.A45.id, 'RETURN_DEVICE_45D')!.id);
    letters.A60_45 = await load(byKey(contracts.A60.id, 'RETURN_DEVICE_45D')!.id);
    letters.A60 = await load(byKey(contracts.A60.id, 'CONTRACT_TERMINATION_60D')!.id);
    letters.LONG_45 = await load(byKey(contracts.LONG.id, 'RETURN_DEVICE_45D')!.id);
    letters.LONG = await load(byKey(contracts.LONG.id, 'CONTRACT_TERMINATION_60D')!.id);
    letters.B1 = await load(byKey(contracts.B1.id, 'RETURN_DEVICE_45D')!.id);
    // Idempotent: a second run adds nothing for these contracts.
    await cron.run();
    expect((await worldLetters()).length).toBe(6);
    const ownerAlerts = h.external.calls.filter((call) => call.recipient === `TEST-NOT-SENT-OWNER-${world.prefix}`);
    expect(ownerAlerts.length).toBeGreaterThanOrEqual(1);
    expect(ownerAlerts[0].summary).toContain('หนังสือทวงถามใหม่');
    outboundAfterSetup = h.external.calls.length;
    const artifact = saveArtifact(DOMAIN, 'letters-created.json', JSON.stringify({ created, letters, ownerAlerts, contracts: Object.fromEntries(Object.entries(contracts).map(([k, v]) => [k, { id: v.id, contractNumber: v.contractNumber, overdue: expectedLetterFigures(v) }])) }, null, 2)).relativePath;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/auto-generate`, title: 'LetterAutoGenerateCron.run(): disabled flag → nothing; enabled → 45D for 4 contracts (≥45 days overdue), 60D for the 2 past 60 days, none for a 20-day contract or an ACTIVE one; ST-YYYY-NNNNN unique; second run idempotent; owner LINE alert recorded not sent', documents: ['RETURN_DEVICE_45D', 'CONTRACT_TERMINATION_60D'], routes: ['LetterAutoGenerateCron.run() (cron 09:15 Asia/Bangkok)'], renderer: 'none', artifacts: [artifact], notes: 'Letters are created on contract status OVERDUE/DEFAULT + an unpaid installment older than the threshold — the letter status starts PENDING_DISPATCH (tab "รอพิมพ์")' }));
  });

  it('listing and counts follow the real branch scope: SALES/BM see their branch only, cross-branch roles everything, a foreign branchId is refused for branch-scoped roles', async () => {
    const list = async (session: Session, query: Record<string, string | number> = {}) => rowsOf(await ok(c(session).get('/overdue/letters').query({ status: 'PENDING_DISPATCH', q: world.prefix, limit: 200, ...query }), 200, `list ${session.user.role}`));
    const numbers = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.letterNumber as string).sort();
    const all = [letters.A45, letters.A60_45, letters.A60, letters.LONG_45, letters.LONG, letters.B1].map((l) => l.letterNumber).sort();
    const branchA = all.filter((n) => n !== letters.B1.letterNumber);
    expect(numbers(await list(owner))).toEqual(all);
    expect(numbers(await list(financeManager))).toEqual(all);
    expect(numbers(await list(accountant))).toEqual(all);
    expect(numbers(await list(branchManagerA))).toEqual(branchA);
    expect(numbers(await list(salesA))).toEqual(branchA);
    expect(numbers(await list(salesB))).toEqual([letters.B1.letterNumber]);
    // An explicit foreign branchId is rejected by BranchGuard for branch-scoped roles (not silently widened).
    await ok(c(salesA).get('/overdue/letters').query({ status: 'PENDING_DISPATCH', branchId: world.branches.b.id }), 403, 'SALES foreign branchId');
    expect(numbers(await list(owner, { branchId: world.branches.b.id }))).toEqual([letters.B1.letterNumber]);
    expect(numbers(await list(owner, { letterType: 'CONTRACT_TERMINATION_60D' }))).toEqual([letters.A60.letterNumber, letters.LONG.letterNumber].sort());
    const row = (await list(owner)).find((r) => r.letterNumber === letters.A45.letterNumber)!;
    expect((row.contract as { contractNumber: string; customer: { name: string }; branch: { name: string } })).toMatchObject({ contractNumber: contracts.A45.contractNumber, customer: { name: world.customer.name }, branch: { name: world.branches.a.name } });
    const counts = (await ok(c(salesB).get('/overdue/letters/counts').query({ q: world.prefix }), 200, 'counts')).body.data as Record<string, number>;
    expect(counts.PENDING_DISPATCH).toBe(1);
    await ok(c(null).get('/overdue/letters'), 401, 'no token');
    const artifact = saveArtifact(DOMAIN, 'list-scope.json', JSON.stringify({ all, branchA, counts }, null, 2)).relativePath;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/list-scope`, title: 'GET /overdue/letters + /counts: OWNER/FM/ACCOUNTANT see all 6, BM/SALES only their branch (5 vs 1), a foreign branchId is 403 for SALES (BranchGuard), letterType filter, no token 401', routes: ['GET /api/overdue/letters', 'GET /api/overdue/letters/counts'], renderer: 'none', artifacts: [artifact], notes: 'Branch roles reach these routes with ?company=shop (their only accessible company) — the same scope the web sends' }));
  });

  it('server-rendered 45-day letter: A4, TH Sarabun 16/18/12 pt, wording and figures from the contract rows, closing kept with the signature; downloading it changes nothing', async () => {
    const letter = letters.A45;
    const contract = contracts.A45;
    const figures = expectedLetterFigures(contract);
    const company = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
    const before = { row: await load(letter.id), audits: (await audits(letter.id)).length };
    const response = await pdfOf(salesA, letter.id);
    expect(response.headers['content-type']).toMatch(/application\/pdf/);
    expect(response.headers['content-disposition']).toBe(`inline; filename="letter-${letter.id}.pdf"`);
    const bytes = bodyBuffer(response);
    const pdf = await parsePdf(bytes);
    const artifacts = [
      saveArtifact(DOMAIN, `${letter.letterNumber}-45D.pdf`, bytes).relativePath,
      saveArtifact(DOMAIN, `${letter.letterNumber}-45D.pdf.json`, JSON.stringify({ letter, figures, sha256: sha256(bytes), ...pdfSummary(pdf) }, null, 2)).relativePath,
    ];
    baseline(pdf, company);
    // The 45-day demand letter carries the fixed legal text (2 demands + 4 legal consequences + coordinator);
    // at 16 pt it may run onto a second page — recorded, and the closing block must then sit with the signature.
    expect(pdf.pageCount).toBeLessThanOrEqual(2);
    const closingPage = pageContaining(pdf, 'จึงเรียนมาเพื่อโปรดดำเนินการโดยเร่งด่วน');
    expect(closingPage).toBe(pdf.pageCount);
    expect(pageContaining(pdf, `[ ${company.directorName} ]`)).toBe(closingPage);
    const lastPageLines = pdf.pages[pdf.pageCount - 1].lines.length;
    expect(sizesOfText(pdf, `เลขที่ ${letter.letterNumber}`)).toEqual([DOCUMENT_STYLE.footerPt]);
    expectAll(pdf, [
      company.nameTh, company.address, `วันที่ ${thaiLongDate(new Date())}`,
      'แจ้งเตือนให้ชำระค่าเช่าซื้อที่ค้างชำระ และ/หรือ ส่งมอบโทรศัพท์มือถือที่เช่าซื้อคืน',
      `เรียน ${world.customer.name}`, `สัญญาเช่าซื้อโทรศัพท์มือถือ เลขที่ ${contract.contractNumber}`,
      `ยี่ห้อ ${contract.product.brand} รุ่น ${contract.product.model} ${contract.product.storage} สี${contract.product.color} หมายเลข IMEI ${contract.product.imei}`,
      `จำนวน ${contract.months} งวด งวดละ ${letterMoney(contract.monthly)} บาท`, 'ทุกวันที่ 5 ของเดือน',
      `ผิดนัดชำระค่าเช่าซื้องวดประจำเดือน ${figures.overdueMonths.join(', ')}`, `ติดต่อกันเป็นจำนวน ${figures.overdueInstallments} งวด`,
      `จำนวน ${letterMoney(figures.principal)} บาท พร้อมเบี้ยปรับ ${letterMoney(figures.lateFee)} บาท รวมเป็นเงินทั้งสิ้น ${letterMoney(figures.total)} บาท (${thaiBahtText(Number(figures.total))})`,
      'ภายใน 7 วัน', 'การบอกเลิกสัญญา', 'การยึดคืนทรัพย์สิน', 'การดำเนินคดีทางแพ่ง', 'การดำเนินคดีทางอาญา',
      'ทดสอบระบบ ผู้ประสานงาน', '02-000-0000',
      'จึงเรียนมาเพื่อโปรดดำเนินการโดยเร่งด่วน', 'ขอแสดงความนับถือ', `[ ${company.directorName} ]`, `หน้า 1 / ${pdf.pageCount}`,
    ]);
    expect(figures.overdueInstallments).toBe(2);
    // Same content when rendered again by another role; no state change from either download.
    const again = await parsePdf(bodyBuffer(await pdfOf(accountant, letter.id)));
    expect(contentSignature(again)).toBe(contentSignature(pdf));
    const after = { row: await load(letter.id), audits: (await audits(letter.id)).length };
    expect(after).toEqual(before);
    expect(after.row.status).toBe('PENDING_DISPATCH');
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/pdf-45d`, title: `GET /overdue/letters/:id/pdf (SALES own branch): ${pdf.pageCount} A4 page(s), THSarabunPSK only, body 16 / company 18 / footer 12 pt, months + installments + principal/late fee/total (Thai words) from the payment rows, coordinator line, closing + signature together on the last page; re-render identical; status/audit untouched`, documents: ['RETURN_DEVICE_45D'], routes: ['GET /api/overdue/letters/:id/pdf'], artifacts, notes: `Observation: the standard 45-day letter (2 overdue months, coordinator line) renders on ${pdf.pageCount} page(s) at the mandated 16 pt — the fixed legal text (2 demands + 4 consequences) does not fit one A4 page; last page holds ${lastPageLines} text lines. "ค่าเช่าซื้อที่ค้างชำระทั้งหมด" sums every unpaid installment including those not yet due (whole remaining balance) — wording kept as is` }));
  });

  it('server-rendered 60-day termination letter carries the termination wording and the same total', async () => {
    const letter = letters.A60;
    const contract = contracts.A60;
    const figures = expectedLetterFigures(contract);
    const company = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
    const bytes = bodyBuffer(await pdfOf(branchManagerA, letter.id));
    const pdf = await parsePdf(bytes);
    expect(pdf.pageCount).toBe(1);
    baseline(pdf, company);
    expectAll(pdf, [
      'บอกเลิกสัญญาเช่าซื้อ และขอให้ส่งคืนทรัพย์สินที่เช่าซื้อพร้อมชำระหนี้ค้างชำระ', `เรียน ${world.customer.name}`, contract.contractNumber,
      `เดือนละ ${letterMoney(contract.monthly)} บาท จำนวน ${contract.months} งวด`, `ตั้งแต่งวดประจำเดือน ${figures.firstMonth} เป็นต้นมา`,
      `ยอดค้างชำระสะสมรวมทั้งสิ้น ${letterMoney(figures.total)} บาท`, 'จึงขอบอกเลิกสัญญาเช่าซื้อฉบับดังกล่าวกับท่านทันที', 'ส่งมอบทรัพย์สินที่เช่าซื้อคืน', 'ชำระหนี้ค้างชำระและค่าเสียหาย',
      `${letterMoney(figures.total)} บาท (${thaiBahtText(Number(figures.total))})`, 'ความผิดฐานยักยอกทรัพย์', 'จึงเรียนมาเพื่อโปรดดำเนินการ', 'ขอแสดงความนับถือ', `[ ${company.directorName} ]`,
    ]);
    expect(has(pdf, 'โดยเร่งด่วน')).toBe(false);
    expect(figures.overdueInstallments).toBe(3);
    const artifacts = [
      saveArtifact(DOMAIN, `${letter.letterNumber}-60D.pdf`, bytes).relativePath,
      saveArtifact(DOMAIN, `${letter.letterNumber}-60D.pdf.json`, JSON.stringify({ letter, figures, ...pdfSummary(pdf) }, null, 2)).relativePath,
    ];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/pdf-60d`, title: 'CONTRACT_TERMINATION_60D letter (BRANCH_MANAGER own branch): termination subject, first overdue month, cumulative total in figures and Thai words, closing without "โดยเร่งด่วน"', documents: ['CONTRACT_TERMINATION_60D'], routes: ['GET /api/overdue/letters/:id/pdf'], artifacts }));
  });

  it('long content continues onto a second A4 page without shrinking the font; the closing sentence and the signature block stay together on the last page', async () => {
    const letter = letters.LONG;
    const contract = contracts.LONG;
    const figures = expectedLetterFigures(contract);
    const company = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
    const bytes45 = bodyBuffer(await pdfOf(owner, letters.LONG_45.id));
    const pdf45 = await parsePdf(bytes45);
    const bytes = bodyBuffer(await pdfOf(owner, letter.id));
    const pdf = await parsePdf(bytes);
    for (const [label, doc] of [['45D', pdf45], ['60D', pdf]] as const) {
      expect({ label, pages: doc.pageCount }).toEqual({ label, pages: expect.any(Number) });
      baseline(doc, company);
      const last = doc.pageCount;
      expect(pageContaining(doc, 'ขอแสดงความนับถือ')).toBe(last);
      expect(pageContaining(doc, `[ ${company.directorName} ]`)).toBe(last);
      expect(pageContaining(doc, label === '45D' ? 'จึงเรียนมาเพื่อโปรดดำเนินการโดยเร่งด่วน' : 'จึงเรียนมาเพื่อโปรดดำเนินการ')).toBe(last);
      for (let page = 1; page <= last; page += 1) expect(has(doc, `หน้า ${page} / ${last}`)).toBe(true);
      expect(doc.pages.every((p) => p.lines.length >= 3)).toBe(true);
    }
    expect(pdf45.pageCount).toBeGreaterThanOrEqual(2);
    expect(figures.overdueInstallments).toBeGreaterThanOrEqual(30);
    for (const month of figures.overdueMonths) expect({ month, found: has(pdf45, month) }).toEqual({ month, found: true });
    expectAll(pdf45, [contract.product.model, `ติดต่อกันเป็นจำนวน ${figures.overdueInstallments} งวด`, letterMoney(figures.total)]);
    const artifacts = [
      saveArtifact(DOMAIN, `${letters.LONG_45.letterNumber}-45D-long.pdf`, bytes45).relativePath,
      saveArtifact(DOMAIN, `${letters.LONG_45.letterNumber}-45D-long.pdf.json`, JSON.stringify({ figures, ...pdfSummary(pdf45) }, null, 2)).relativePath,
      saveArtifact(DOMAIN, `${letter.letterNumber}-60D-long.pdf`, bytes).relativePath,
      saveArtifact(DOMAIN, `${letter.letterNumber}-60D-long.pdf.json`, JSON.stringify({ figures, ...pdfSummary(pdf) }, null, 2)).relativePath,
    ];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/continuation`, title: `36-month contract with ${figures.overdueInstallments} overdue installments and a long model name: 45D letter = ${pdf45.pageCount} pages, 60D = ${pdf.pageCount}; body stays 16 pt, every overdue month printed, footer "หน้า n / N" on each page, closing + signature on the last page`, documents: ['RETURN_DEVICE_45D', 'CONTRACT_TERMINATION_60D'], routes: ['GET /api/overdue/letters/:id/pdf'], artifacts, notes: 'Pagination is Chromium\'s (CSS .letter-closing { break-inside: avoid }); the letter has no customer address block, so length comes from the overdue month list and product description' }));
  });

  it('print confirmation is explicit and idempotent; dispatch needs a printed letter and a tracking number; the 60-day dispatch terminates the contract', async () => {
    const mark = (session: Session, id: string, body: Record<string, unknown> = {}) => c(session).post(`/overdue/letters/${id}/pdf-generated`, body);
    const a45 = letters.A45;
    // Dispatch before printing is refused; a bare mark moves PENDING_DISPATCH → PDF_GENERATED without a stored file.
    await ok(c(salesA).post(`/overdue/letters/${a45.id}/dispatch`, { trackingNumber: 'EM000000001TH' }), 400, 'dispatch before print');
    await ok(mark(salesA, a45.id), 201, 'mark printed');
    let row = await load(a45.id);
    expect(row).toMatchObject({ status: 'PDF_GENERATED', pdfUrl: null });
    expect(row.pdfGeneratedAt).not.toBeNull();
    expect((await audits(a45.id)).map((a) => a.action)).toEqual(['LETTER_PDF_GENERATED']);
    // A lost response is retried, two confirmations race — still exactly one audit row.
    const race = await Promise.all([mark(salesA, a45.id), mark(salesA, a45.id)]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 201]);
    await ok(mark(owner, a45.id), 201, 'retry after lost response');
    expect((await audits(a45.id)).map((a) => a.action)).toEqual(['LETTER_PDF_GENERATED']);
    // A retry that carries a stored file URL on an already-printed letter is not a silent no-op.
    await ok(mark(owner, a45.id, { pdfUrl: 'https://example.invalid/legacy.pdf' }), 400, 'mark with pdfUrl after printed');
    // Dispatch: tracking validation, then DISPATCHED + audit; the recorded transport catches any LINE event.
    await ok(c(salesA).post(`/overdue/letters/${a45.id}/dispatch`, { trackingNumber: 'EM1' }), 400, 'short tracking');
    const outboundBefore = h.external.calls.length;
    await ok(c(salesA).post(`/overdue/letters/${a45.id}/dispatch`, { trackingNumber: `EM${world.prefix.slice(-6)}01TH` }), 201, 'dispatch');
    row = await load(a45.id);
    expect(row).toMatchObject({ status: 'DISPATCHED', dispatchedById: salesA.user.id, trackingNumber: `EM${world.prefix.slice(-6)}01TH` });
    expect((await audits(a45.id)).map((a) => a.action)).toEqual(['LETTER_PDF_GENERATED', 'LETTER_DISPATCHED']);
    await ok(c(salesA).post(`/overdue/letters/${a45.id}/dispatch`, { trackingNumber: `EM${world.prefix.slice(-6)}02TH` }), 400, 'dispatch twice');
    // 60-day letter: dispatch terminates the contract and writes the legal status audit.
    await ok(mark(branchManagerA, letters.A60.id), 201, 'mark 60D');
    await ok(c(branchManagerA).post(`/overdue/letters/${letters.A60.id}/dispatch`, { trackingNumber: `EM${world.prefix.slice(-6)}60TH` }), 201, 'dispatch 60D');
    expect((await h.prisma.contract.findUniqueOrThrow({ where: { id: contracts.A60.id } })).status).toBe('TERMINATED');
    const legal = await h.prisma.auditLog.findMany({ where: { entity: 'contract', entityId: contracts.A60.id, action: 'CONTRACT_STATUS_LEGAL' } });
    expect(legal.length).toBe(1);
    expect(legal[0].newValue).toMatchObject({ from: 'OVERDUE', to: 'TERMINATED' });
    // The 45D letter of the same contract is untouched by the 60D dispatch.
    expect((await load(letters.A60_45.id)).status).toBe('PENDING_DISPATCH');
    // Bulk dispatch: whole batch validated, >50 refused, mixed statuses refused, happy path stamps one batchId.
    await ok(mark(owner, letters.A60_45.id), 201, 'mark A60_45');
    await ok(mark(owner, letters.LONG_45.id), 201, 'mark LONG_45');
    // Regression (defect found in this issue): `POST letters/bulk/dispatch` used to be declared after
    // `POST letters/:id/dispatch`, so Nest routed it as id="bulk" → 404 "ไม่พบหนังสือ" for every bulk EMS
    // confirmation the web sends. It must reach the DTO validation / service now.
    const tooMany = await c(owner).post('/overdue/letters/bulk/dispatch', { items: Array.from({ length: 51 }, (_, i) => ({ id: letters.LONG_45.id, trackingNumber: `EM0000000${i}TH` })) });
    expect(tooMany.status).toBe(400);
    expect(String(tooMany.body.message)).toContain('ไม่เกิน 50');
    const unknown = await c(owner).post('/overdue/letters/bulk/dispatch', { items: [{ id: '00000000-0000-4000-8000-000000000000', trackingNumber: 'EM000000000TH' }] });
    expect(unknown.status).toBe(400);
    expect(String(unknown.body.message)).toContain('ไม่พบจดหมาย');
    await ok(c(owner).post('/overdue/letters/bulk/dispatch', { items: [{ id: letters.A60_45.id, trackingNumber: 'EM000000010TH' }, { id: letters.LONG.id, trackingNumber: 'EM000000011TH' }] }), 400, 'bulk with a PENDING letter');
    expect((await load(letters.A60_45.id)).status).toBe('PDF_GENERATED');
    const bulk = (await ok(c(owner).post('/overdue/letters/bulk/dispatch', { items: [{ id: letters.A60_45.id, trackingNumber: 'EM000000010TH' }, { id: letters.LONG_45.id, trackingNumber: 'EM000000011TH' }] }), 201, 'bulk dispatch')).body.data as { updated: Array<{ id: string }>; batchId: string };
    expect(bulk.updated.map((u) => u.id).sort()).toEqual([letters.A60_45.id, letters.LONG_45.id].sort());
    for (const id of [letters.A60_45.id, letters.LONG_45.id]) {
      expect((await load(id)).status).toBe('DISPATCHED');
      expect((await audits(id)).at(-1)?.newValue).toMatchObject({ batchId: bulk.batchId, source: 'bulk' });
    }
    const outbound = h.external.calls.slice(outboundBefore);
    const artifact = saveArtifact(DOMAIN, 'confirmations.json', JSON.stringify({ a45: await load(a45.id), a60: await load(letters.A60.id), audits: { a45: await audits(a45.id), a60: await audits(letters.A60.id) }, bulk, outboundDuringDispatch: outbound }, null, 2)).relativePath;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/confirmations`, title: 'pdf-generated: bare confirmation moves to PDF_GENERATED, concurrent duplicates + a retry after a lost response leave one audit row, a pdfUrl on a printed letter is refused; dispatch: refused before printing / short tracking / twice, DISPATCHED + audit, 60D dispatch → contract TERMINATED + CONTRACT_STATUS_LEGAL; bulk dispatch: >50 and mixed statuses refused, batchId in audit', documents: ['RETURN_DEVICE_45D', 'CONTRACT_TERMINATION_60D'], routes: ['POST /api/overdue/letters/:id/pdf-generated', 'POST /api/overdue/letters/:id/dispatch', 'POST /api/overdue/letters/bulk/dispatch'], renderer: 'none', artifacts: [artifact], notes: `Defect fixed in this issue: POST /overdue/letters/bulk/dispatch was declared after POST /overdue/letters/:id/dispatch, so Nest routed it as id="bulk" → 404 "ไม่พบหนังสือ" for every bulk EMS confirmation the web sends; the route now sits above the :id routes. ${outbound.length} recorded outbound call(s) during dispatch (dunning events), none sent` }));
  });

  it('cancel versus print: cancellation of a printed-or-pending letter wins over a late confirmation, needs a reason and a manager role; nothing after dispatch can be cancelled', async () => {
    const b1 = letters.B1;
    await ok(c(salesB).post(`/overdue/letters/${b1.id}/cancel`, { reason: 'ยกเลิกตามคำสั่งทดสอบระบบ' }), 403, 'SALES cancel');
    await ok(c(owner).post(`/overdue/letters/${b1.id}/cancel`, { reason: 'สั้น' }), 400, 'reason too short');
    await ok(c(owner).post(`/overdue/letters/${b1.id}/cancel`, { reason: 'ยกเลิกตามคำสั่งทดสอบระบบ' }), 201, 'OWNER cancel');
    expect(await load(b1.id)).toMatchObject({ status: 'CANCELLED' });
    const auditCount = (await audits(b1.id)).length;
    // A confirmation that arrives after the cancellation is refused and adds no audit row.
    await ok(c(salesB).post(`/overdue/letters/${b1.id}/pdf-generated`), 400, 'mark after cancel');
    expect((await audits(b1.id)).length).toBe(auditCount);
    expect((await audits(b1.id)).map((a) => a.action)).toEqual(['CANCEL_LETTER']);
    // The two requests racing on the same letter: exactly one of the terminal states, one audit row.
    const race = letters.LONG;
    const [cancelled, marked] = await Promise.all([c(owner).post(`/overdue/letters/${race.id}/cancel`, { reason: 'ยกเลิกระหว่างยืนยันพิมพ์ ทดสอบระบบ' }), c(owner).post(`/overdue/letters/${race.id}/pdf-generated`)]);
    const final = await load(race.id);
    const raceAudits = (await audits(race.id)).map((a) => a.action);
    if (final.status === 'CANCELLED') {
      expect(cancelled.status).toBe(201);
      expect([200, 201, 400]).toContain(marked.status);
      if (marked.status === 400) expect(raceAudits).toEqual(['CANCEL_LETTER']);
      else expect(raceAudits.sort()).toEqual(['CANCEL_LETTER', 'LETTER_PDF_GENERATED']);
    } else {
      expect(final.status).toBe('PDF_GENERATED');
      expect(marked.status).toBe(201);
      expect(cancelled.status).toBe(201);
      expect(raceAudits.sort()).toEqual(['CANCEL_LETTER', 'LETTER_PDF_GENERATED']);
    }
    // Dispatched letters cannot be cancelled; the cancelled letter still renders for the record but cannot be dispatched.
    await ok(c(owner).post(`/overdue/letters/${letters.A45.id}/cancel`, { reason: 'ยกเลิกหลังส่ง ทดสอบระบบ' }), 400, 'cancel after dispatch');
    await ok(c(owner).post(`/overdue/letters/${b1.id}/dispatch`, { trackingNumber: 'EM000000099TH' }), 400, 'dispatch cancelled');
    await pdfOf(owner, b1.id, 200);
    const artifact = saveArtifact(DOMAIN, 'cancel-vs-mark.json', JSON.stringify({ b1: await load(b1.id), race: { final, cancelled: cancelled.status, marked: marked.status, audits: raceAudits } }, null, 2)).relativePath;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/cancel-vs-mark`, title: `cancel: SALES 403, reason < 5 chars 400, OWNER 201 → CANCELLED; a late print confirmation is 400 with no extra audit; concurrent cancel + confirm settle on ${final.status} with consistent audit rows; DISPATCHED cannot be cancelled, CANCELLED cannot be dispatched`, routes: ['POST /api/overdue/letters/:id/cancel', 'POST /api/overdue/letters/:id/pdf-generated', 'POST /api/overdue/letters/:id/dispatch'], renderer: 'none', artifacts: [artifact], notes: 'Observation: GET /overdue/letters/:id/pdf still renders a CANCELLED letter (the guard checks existence and branch, not status) — acceptable for the record, but the page hides the row under the ยกเลิก tab without a print action' }));
  });

  it('authorization on the document routes: foreign branch 403 for SALES and BM, branchless BM 403, unknown / deleted letter and deleted contract 404, no token 401 — before any render or audit', async () => {
    const branchless = await h.prisma.user.create({ data: { email: `${world.prefix.toLowerCase()}.bm-none@example.invalid`, password: (await h.prisma.user.findUniqueOrThrow({ where: { id: world.users.owner.id } })).password, name: 'ทดสอบระบบ BRANCH_MANAGER ไม่มีสาขา', role: 'BRANCH_MANAGER', branchId: null, accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' } });
    const branchlessSession = await h.login(branchless.email, world.password);
    const target = letters.A60; // branch A, already DISPATCHED — reads only
    const auditCount = (await audits(target.id)).length;
    await pdfOf(salesB, target.id, 403);
    await ok(c(salesB).post(`/overdue/letters/${target.id}/pdf-generated`), 403, 'SALES B mark');
    await pdfOf(branchlessSession, target.id, 403);
    await ok(c(branchlessSession).post(`/overdue/letters/${target.id}/pdf-generated`), 403, 'branchless BM mark');
    await pdfOf(null, target.id, 401);
    await pdfOf(owner, '00000000-0000-4000-8000-000000000000', 404);
    await ok(c(owner).post('/overdue/letters/00000000-0000-4000-8000-000000000000/pdf-generated'), 404, 'unknown mark');
    // Soft-deleted letter and soft-deleted contract vanish from the document routes (then restored).
    const deleted = letters.FRESH_LETTER ?? letters.LONG_45;
    await h.prisma.contractLetter.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    try {
      await pdfOf(owner, deleted.id, 404);
      await ok(c(owner).post(`/overdue/letters/${deleted.id}/pdf-generated`), 404, 'deleted letter mark');
    } finally {
      await h.prisma.contractLetter.update({ where: { id: deleted.id }, data: { deletedAt: null } });
    }
    await h.prisma.contract.update({ where: { id: contracts.A60.id }, data: { deletedAt: new Date() } });
    try {
      await pdfOf(owner, target.id, 404);
      await ok(c(owner).post(`/overdue/letters/${target.id}/pdf-generated`), 404, 'deleted contract mark');
    } finally {
      await h.prisma.contract.update({ where: { id: contracts.A60.id }, data: { deletedAt: null } });
    }
    expect((await audits(target.id)).length).toBe(auditCount);
    await ok(h.client({ token: `${owner.token.slice(0, -4)}AAAA`, company: 'FINANCE' }).get(`/overdue/letters/${target.id}/pdf`), 401, 'tampered token');
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/authorization`, title: 'LetterDocumentAccessGuard on pdf + pdf-generated: SALES other branch 403, BRANCH_MANAGER without branch 403, unknown id 404, soft-deleted letter 404, soft-deleted contract 404 (same message), no/tampered token 401 — no audit rows written', routes: ['GET /api/overdue/letters/:id/pdf', 'POST /api/overdue/letters/:id/pdf-generated'], renderer: 'none', artifacts: [] }));
  });

  it('no outbound transport left the process; everything recorded went to synthetic recipients', () => {
    expect(h.external.calls.length).toBeGreaterThanOrEqual(outboundAfterSetup);
    expect(h.external.calls.every((call) => /TEST-NOT-SENT|example\.invalid|^08000/.test(call.recipient))).toBe(true);
    const artifact = saveArtifact(DOMAIN, 'outbound.json', JSON.stringify(h.external.calls, null, 2)).relativePath;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: `Outbound recorder: ${h.external.calls.length} call(s) captured (owner alert of the letter job, dunning events), all to synthetic recipients, none sent`, routes: [], renderer: 'none', artifacts: [artifact] }));
  });
});
