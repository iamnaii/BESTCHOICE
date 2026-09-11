/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserContext, Page } from '@playwright/test';
import { DOCUMENT_STYLE } from '@installment/shared';
import { DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld, SIGNATURE_PNG, WorldUser } from './support/fixtures';
import { clearSystemConfig, fixed2, setSystemConfig } from './support/expense-fixtures';
import { createLoginPacer } from './support/payroll-fixtures';
import { mintExpiredAdminToken, mirroredJournalLines, sortJournalLines } from './support/other-income-fixtures';
import { DividendLineSpec, dividendRegisterExpectation, dividendTotals, dividendWht, EQUITY_MAKER_CHECKER_KEY, expectedDeclarationJournal, expectedPaymentJournal, ShareholderKind } from './support/dividend-fixtures';
import { recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { foldThai, isA4, isA4Landscape, pageContaining, parsePdf, ParsedPdf, textSizes } from './support/pdf';
import { startWeb, WebRuntime } from './support/web';
import { EquityAttachmentService } from '../../src/modules/equity/services/equity-attachment.service';

/**
 * DOC-08 (issue #1567): dividend declarations and payments through the real
 * equity API (shareholder register, DIV_DEC with the resolution attachment,
 * DIV_PAY with the ม.50(2) withholding, maker-checker, reverse) → the yearly
 * dividend register → the ม.50 ทวิ certificate per shareholder and the ภ.ง.ด.2
 * preview / XLSX, plus the real admin web app (Vite proxy + Playwright) for
 * /finance/dividend-register and its certificate dialog. Separate from the
 * payroll annual certificate of DOC-04 (different payer form, ภ.ง.ด.2 not 1ก).
 *
 * Tax rules are the system's own (10% on individuals and foreign juristic
 * recipients by default, nothing on Thai juristic recipients) — nothing is
 * redefined here.
 */
const DOMAIN = 'dividend-wht';
const GUARDS = [
  'CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard(OWNER/FINANCE_MANAGER/ACCOUNTANT; post & reverse OWNER/FINANCE_MANAGER)', 'AuditInterceptor',
  'EQUITY_MAKER_CHECKER_ENABLED (approver ≠ maker)', 'equity validators V_RESOLUTION/V8 attachment/PAYMENT/V_SH_UNIQUE/WHT_RANGE', 'GL guard V_DIV_PAY_LE_PAYABLE', 'period lock at txnDate',
];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded by the harness, never sent',
  'storage backend is a private local folder (the resolution attachment goes through the real StorageService)',
  'shareholders are synthetic rows with marked names and synthetic tax ids',
  'the certificate and the register are browser documents — captured with Chromium print-media page.pdf() of the real page',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['WHT_CERTIFICATE_50BIS'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

type Shareholder = { id: string; name: string; taxId: string | null; type: ShareholderKind; shares: number; isActive: boolean };
type EquityLine = { shareholderId: string; shareholderName: string; lineNo: number; amount: string; wht: string };
type EquityDoc = { id: string; docNumber: string; txnType: string; status: string; txnDate: string; paymentAccountCode: string | null; resolutionNo: string | null; makerId: string; approverId: string | null; journalEntryId: string | null; reverseJournalEntryId: string | null; reverseReason: string | null; lines: EquityLine[]; attachments?: unknown[] };
type RegisterRow = { shareholderId: string; name: string; taxId: string | null; type: ShareholderKind; payCount: number; gross: string; wht: string; net: string; docNumbers: string[] };
type Register = { year: number; rows: RegisterRow[]; totals: { gross: string; wht: string; net: string } };
type Pnd2 = { items: Array<{ shareholderName: string; taxId: string | null; type: string; gross: string; whtAmount: string; payDate: string; docNumber: string }>; grossIncome: string; whtTotal: string; count: number; period: unknown; form: string };

const BANK = '11-1201';
const YEAR = 2026;

describe('DOC-08 dividend withholding certificates and register — real equity commands, real journal, real tax preview and print entries', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let web: WebRuntime | null = null;
  let owner: Session, accountant: Session, financeManager: Session, salesA: Session, branchManagerA: Session;
  let financeCompany: { id: string; nameTh: string; taxId: string; address: string; directorName: string };
  let s1: Shareholder, s2: Shareholder, s3: Shareholder;
  const pace = createLoginPacer();
  const docs: Record<string, EquityDoc> = {};
  let accountantSession: { context: BrowserContext; page: Page; errors: string[]; runtime: WebRuntime } | null = null;
  const LONG_NAME_BODY = 'บริษัท ผู้ถือหุ้นต่างประเทศ ชื่อยาวมากสำหรับทดสอบการตัดบรรทัดของหนังสือรับรอง (ประเทศสิงคโปร์) พีทีอี ลิมิเต็ด สาขาประเทศไทย';

  const api = (session: Session | null, company?: 'SHOP' | 'FINANCE' | null) => h.client({ session, company });
  const f2 = (value: unknown) => Number(value).toFixed(2);
  const th = (value: unknown) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lineSpecs = (lines: Array<{ sh: Shareholder; amount: number; wht?: number }>): DividendLineSpec[] => lines.map((line) => ({ shareholderId: line.sh.id, type: line.sh.type, amount: line.amount, wht: line.wht }));
  const createDoc = async (session: Session, body: Record<string, unknown>): Promise<EquityDoc> => (await api(session).post('/equity/documents', body).expect(201)).body.data;
  const getDoc = async (session: Session, id: string): Promise<EquityDoc> => (await api(session).get(`/equity/documents/${id}`).expect(200)).body.data;
  const post = (session: Session, id: string) => api(session).post(`/equity/documents/${id}/post`);
  const declaration = (txnDate: string, resolutionNo: string, lines: Array<{ sh: Shareholder; amount: number }>) => ({ txnType: 'DIV_DEC', txnDate, description: 'ประกาศจ่ายเงินปันผล (ทดสอบระบบ)', resolutionNo, resolutionDate: txnDate, lines: lines.map((line) => ({ shareholderId: line.sh.id, amount: line.amount })) });
  const payment = (txnDate: string, lines: Array<{ sh: Shareholder; amount: number; wht?: number }>) => ({ txnType: 'DIV_PAY', txnDate, description: 'จ่ายเงินปันผล (ทดสอบระบบ)', paymentAccountCode: BANK, lines: lines.map((line) => ({ shareholderId: line.sh.id, amount: line.amount, ...(line.wht == null ? {} : { wht: line.wht }) })) });
  const attachResolution = async (docId: string) => {
    // The multipart route's FileTypeValidator cannot load the ESM `file-type` package inside jest (see DOC-05) — the
    // service behind it (magic bytes, real StorageService, attachment row) is exercised directly.
    const png = Buffer.from(SIGNATURE_PNG.split(',')[1], 'base64');
    const file = { buffer: png, mimetype: 'image/png', originalname: 'board-resolution.png', size: png.length, fieldname: 'file', encoding: '7bit' } as unknown as Express.Multer.File;
    return h.app.get(EquityAttachmentService).upload(docId, file, world.users.accountant.id);
  };
  const declareAndPost = async (txnDate: string, resolutionNo: string, lines: Array<{ sh: Shareholder; amount: number }>, poster: Session = financeManager): Promise<EquityDoc> => {
    const created = await createDoc(accountant, declaration(txnDate, resolutionNo, lines));
    await attachResolution(created.id);
    expect([200, 201]).toContain((await post(poster, created.id)).status);
    const doc = await getDoc(accountant, created.id);
    expect(doc.status).toBe('POSTED');
    expect(await journalLines(doc.journalEntryId!)).toEqual(expectedDeclarationJournal(lineSpecs(lines)));
    return doc;
  };
  const payAndPost = async (txnDate: string, lines: Array<{ sh: Shareholder; amount: number; wht?: number }>, poster: Session = financeManager): Promise<EquityDoc> => {
    const created = await createDoc(accountant, payment(txnDate, lines));
    expect([200, 201]).toContain((await post(poster, created.id)).status);
    const doc = await getDoc(accountant, created.id);
    expect(doc.status).toBe('POSTED');
    expect(await journalLines(doc.journalEntryId!)).toEqual(expectedPaymentJournal(lineSpecs(lines), BANK));
    for (const line of lines) expect(f2(doc.lines.find((row) => row.shareholderId === line.sh.id)!.wht)).toBe(dividendWht(line.sh.type, line.amount, line.wht).toFixed(2));
    return doc;
  };
  const journalLines = async (journalEntryId: string) => sortJournalLines((await h.prisma.journalLine.findMany({ where: { journalEntryId, deletedAt: null } })).map((row) => ({ accountCode: row.accountCode, debit: fixed2(row.debit), credit: fixed2(row.credit) })));
  const register = async (session: Session, year: number, company?: 'SHOP' | 'FINANCE' | null): Promise<Register> => (await api(session, company).get(`/equity/dividend-register?year=${year}`).expect(200)).body.data;
  const pnd2 = async (session: Session, year: number, month: number): Promise<Pnd2> => (await api(session).get(`/tax/pnd2-preview?year=${year}&month=${month}`).expect(200)).body.data;
  const mineIds = () => new Set([s1.id, s2.id, s3.id]);
  const ourDocCount = () => h.prisma.equityDocument.count({ where: { deletedAt: null, lines: { some: { shareholderId: { in: [...mineIds()] } } } } });
  const pdfSummary = (pdf: ParsedPdf) => ({ pageCount: pdf.pageCount, pages: pdf.pages.map((page) => ({ index: page.index, widthPt: +page.widthPt.toFixed(2), heightPt: +page.heightPt.toFixed(2), lines: page.lines.length, textItems: page.items.filter((item) => item.str.trim()).length })), fonts: pdf.fonts, sizes: textSizes(pdf) });
  const streamText = (pdf: ParsedPdf) => foldThai(pdf.pages.map((page) => page.items.map((item) => item.str).join('')).join('\n'));
  const expectFonts = (pdf: ParsedPdf) => expect(pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
  /** Every text run sits inside its page box — a transform/overflow clip would push runs outside or drop them. */
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

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    financeCompany = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true, nameTh: true, taxId: true, address: true, directorName: true } });
    for (const [key, user] of [['owner', world.users.owner], ['accountant', world.users.accountant], ['financeManager', world.users.financeManager], ['salesA', world.users.salesA], ['branchManagerA', world.users.branchManagerA]] as const) {
      await pace();
      const session = await h.login(user.email, user.password);
      if (key === 'owner') owner = session; else if (key === 'accountant') accountant = session; else if (key === 'financeManager') financeManager = session; else if (key === 'salesA') salesA = session; else branchManagerA = session;
    }
    const create = async (body: Record<string, unknown>): Promise<Shareholder> => (await api(accountant).post('/equity/shareholders', body).expect(201)).body.data;
    s1 = await create({ name: `ทดสอบระบบ ผู้ถือหุ้น หนึ่ง ${world.prefix}`, taxId: '7000000000027', shares: 60, type: 'INDIVIDUAL', note: 'ข้อมูลทดสอบระบบ — ลบได้' });
    s2 = await create({ name: `ทดสอบระบบ บริษัท ผู้ถือหุ้น สอง จำกัด ${world.prefix}`, taxId: '0105500000028', shares: 30, type: 'JURISTIC_TH', note: 'ข้อมูลทดสอบระบบ — ลบได้' });
    s3 = await create({ name: `ทดสอบระบบ ${LONG_NAME_BODY} ${world.prefix}`, shares: 10, type: 'JURISTIC_FOREIGN', note: 'ข้อมูลทดสอบระบบ — ลบได้' });
  }, 240000);

  afterAll(async () => {
    await clearSystemConfig(h.prisma, EQUITY_MAKER_CHECKER_KEY).catch(() => undefined);
    if (accountantSession) await accountantSession.context.close().catch(() => undefined);
    if (web) await web.close();
    await h.close();
  });

  it('authorization — SALES / BRANCH_MANAGER get 403 on the register, shareholders, documents and ภ.ง.ด.2; no or expired token 401; unknown id 404; ACCOUNTANT reads but cannot post or reverse; bad year 400', async () => {
    for (const session of [salesA, branchManagerA]) {
      await api(session).get(`/equity/dividend-register?year=${YEAR}`).expect(403);
      await api(session).get('/equity/shareholders').expect(403);
      await api(session).get('/equity/documents').expect(403);
      await api(session).post('/equity/shareholders', { name: 'ผู้ไม่มีสิทธิ์', type: 'INDIVIDUAL' }).expect(403);
      await api(session).get(`/tax/pnd2-preview?year=${YEAR}&month=3`).expect(403);
      await api(session).get(`/tax/export-xlsx?form=PND2&year=${YEAR}&month=3`).expect(403);
    }
    await api(null).get(`/equity/dividend-register?year=${YEAR}`).expect(401);
    const expired = mintExpiredAdminToken(h.app, { id: world.users.accountant.id, email: world.users.accountant.email, role: 'ACCOUNTANT', branchId: null });
    await h.client({ token: expired, company: 'FINANCE' }).get(`/equity/dividend-register?year=${YEAR}`).expect(401);
    await api(accountant).get('/equity/documents/00000000-0000-4000-8000-000000000000').expect(404);
    await api(accountant).get('/equity/dividend-register?year=2019').expect(400);
    await api(accountant).get('/tax/pnd2-preview?year=2026&month=13').expect(400);
    // The role opens the equity module for reading; posting and reversing are OWNER / FINANCE_MANAGER only.
    const draft = await createDoc(accountant, payment(`${YEAR}-01-15`, [{ sh: s1, amount: 100 }]));
    await post(accountant, draft.id).expect(403);
    await api(accountant).post(`/equity/documents/${draft.id}/reverse`, { reason: 'ทดสอบระบบ ไม่มีสิทธิ์กลับรายการ' }).expect(403);
    expect((await getDoc(accountant, draft.id)).status).toBe('DRAFT');
    await api(accountant).delete(`/equity/documents/${draft.id}`).expect(200);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/authorization`, title: 'SALES and BRANCH_MANAGER are refused on register / shareholders / documents / ภ.ง.ด.2 preview and XLSX (403); missing or expired JWT → 401; unknown document → 404; year < 2020 or month 13 → 400; ACCOUNTANT can read and draft but post/reverse are 403 (OWNER / FINANCE_MANAGER only)', routes: ['GET /api/equity/dividend-register', 'GET /api/equity/shareholders', 'GET /api/equity/documents', 'POST /api/equity/documents/:id/post', 'POST /api/equity/documents/:id/reverse', 'GET /api/tax/pnd2-preview', 'GET /api/tax/export-xlsx'], renderer: 'none', artifacts: [] }));
  }, 120000);

  it('declare → pay: DIV_DEC needs the board resolution attachment, DIV_PAY books the ม.50(2) withholding per recipient type, a payment beyond the declared payable is refused, a payment can be reversed, maker-checker forbids self-approval — across two tax years', async () => {
    // 2026 — one declaration for all three shareholders, paid in full.
    const dec1 = await createDoc(accountant, declaration(`${YEAR}-02-15`, `BM-1/${YEAR + 543} ทดสอบระบบ`, [{ sh: s1, amount: 30000 }, { sh: s2, amount: 20000 }, { sh: s3, amount: 10000 }]));
    expect(dec1.docNumber).toMatch(/^EQ-\d{8}-\d{4}$/);
    const withoutAttachment = await post(financeManager, dec1.id);
    expect(withoutAttachment.status).toBe(400);
    expect(JSON.stringify(withoutAttachment.body)).toContain('V8');
    await attachResolution(dec1.id);
    expect(await h.prisma.equityAttachment.count({ where: { documentId: dec1.id } })).toBe(1);
    const postedDec1 = await post(financeManager, dec1.id);
    expect([200, 201]).toContain(postedDec1.status);
    docs.dec1 = await getDoc(accountant, dec1.id);
    expect(docs.dec1.status).toBe('POSTED');
    expect(docs.dec1.approverId).toBe(world.users.financeManager.id);
    expect(await journalLines(docs.dec1.journalEntryId!)).toEqual(expectedDeclarationJournal(lineSpecs([{ sh: s1, amount: 30000 }, { sh: s2, amount: 20000 }, { sh: s3, amount: 10000 }])));
    const je = await h.prisma.journalEntry.findUniqueOrThrow({ where: { id: docs.dec1.journalEntryId! } });
    expect(je.companyId).toBe(financeCompany.id);
    // Posting again is refused and books nothing more.
    expect([400, 409]).toContain((await post(financeManager, dec1.id)).status);
    expect(await h.prisma.journalEntry.count({ where: { deletedAt: null, metadata: { path: ['equityDocId'], equals: dec1.id } as never } })).toBe(1);

    docs.pay1 = await payAndPost(`${YEAR}-03-10`, [{ sh: s1, amount: 30000 }, { sh: s2, amount: 20000 }, { sh: s3, amount: 10000 }]);
    expect(docs.pay1.lines.map((line) => line.shareholderName)).toEqual([s1.name, s2.name, s3.name]);
    // Nothing declared is left — any further payment must be refused by the GL guard.
    const over = await createDoc(accountant, payment(`${YEAR}-03-20`, [{ sh: s1, amount: 1000 }]));
    const overPost = await post(financeManager, over.id);
    expect(overPost.status).toBe(400);
    expect(JSON.stringify(overPost.body)).toContain('V_DIV_PAY_LE_PAYABLE');
    await api(accountant).delete(`/equity/documents/${over.id}`).expect(200);
    // Duplicate shareholder lines are refused at create (V_SH_UNIQUE).
    expect((await api(accountant).post('/equity/documents', payment(`${YEAR}-03-20`, [{ sh: s1, amount: 100 }, { sh: s1, amount: 200 }]))).status).toBe(400);

    // Second declaration for s1 only, paid with an explicit withholding figure.
    docs.dec2 = await declareAndPost(`${YEAR}-08-20`, `BM-2/${YEAR + 543} ทดสอบระบบ`, [{ sh: s1, amount: 15000 }], owner);
    docs.pay2 = await payAndPost(`${YEAR}-09-05`, [{ sh: s1, amount: 15000, wht: 1500 }]);

    // A payment that is later reversed must leave the register.
    docs.dec3 = await declareAndPost(`${YEAR}-10-10`, `BM-3/${YEAR + 543} ทดสอบระบบ`, [{ sh: s2, amount: 5000 }]);
    docs.pay3 = await payAndPost(`${YEAR}-10-20`, [{ sh: s2, amount: 5000 }]);
    expect((await api(owner).post(`/equity/documents/${docs.pay3.id}/reverse`, { reason: 'สั้น' })).status).toBe(400);
    const reversed = await api(owner).post(`/equity/documents/${docs.pay3.id}/reverse`, { reason: 'ยกเลิกการจ่ายรอบทดสอบระบบ — โอนผิดบัญชี' });
    expect([200, 201]).toContain(reversed.status);
    docs.pay3 = await getDoc(accountant, docs.pay3.id);
    expect(docs.pay3.status).toBe('REVERSED');
    expect(docs.pay3.reverseJournalEntryId).toBeTruthy();
    expect(await journalLines(docs.pay3.reverseJournalEntryId!)).toEqual(mirroredJournalLines(await journalLines(docs.pay3.journalEntryId!)));
    expect([400, 409]).toContain((await api(owner).post(`/equity/documents/${docs.pay3.id}/reverse`, { reason: 'กลับรายการซ้ำ ทดสอบระบบ' })).status);

    // Previous tax year.
    docs.dec0 = await declareAndPost(`${YEAR - 1}-11-01`, `BM-1/${YEAR - 1 + 543} ทดสอบระบบ`, [{ sh: s1, amount: 8000 }]);
    docs.pay0 = await payAndPost(`${YEAR - 1}-12-15`, [{ sh: s1, amount: 8000 }]);

    // Maker-checker: the maker may not post their own document.
    docs.dec4 = await declareAndPost(`${YEAR}-11-05`, `BM-4/${YEAR + 543} ทดสอบระบบ`, [{ sh: s1, amount: 2000 }], owner);
    await setSystemConfig(h.prisma, EQUITY_MAKER_CHECKER_KEY, 'true');
    try {
      expect((await api(financeManager).get('/equity/maker-checker-enabled').expect(200)).body.data).toMatchObject({ enabled: true });
      const pay4 = await createDoc(financeManager, payment(`${YEAR}-11-20`, [{ sh: s1, amount: 2000 }]));
      expect([400, 409]).toContain((await post(financeManager, pay4.id)).status); // DRAFT cannot be posted while the flag is on
      expect((await api(financeManager).post(`/equity/documents/${pay4.id}/submit`)).status).toBe(200);
      expect((await getDoc(accountant, pay4.id)).status).toBe('READY');
      const selfPost = await post(financeManager, pay4.id);
      expect(selfPost.status).toBe(403);
      expect(JSON.stringify(selfPost.body)).toContain('ผู้อนุมัติต้องไม่ใช่ผู้สร้างเอกสาร');
      expect([200, 201]).toContain((await post(owner, pay4.id)).status);
      docs.pay4 = await getDoc(accountant, pay4.id);
      expect(docs.pay4.status).toBe('POSTED');
      expect(docs.pay4.approverId).toBe(world.users.owner.id);
      expect(await journalLines(docs.pay4.journalEntryId!)).toEqual(expectedPaymentJournal(lineSpecs([{ sh: s1, amount: 2000 }]), BANK));
    } finally {
      await clearSystemConfig(h.prisma, EQUITY_MAKER_CHECKER_KEY);
    }
    expect((await api(financeManager).get('/equity/maker-checker-enabled').expect(200)).body.data).toMatchObject({ enabled: false });
    const artifacts = [saveArtifact(DOMAIN, 'equity-documents.json', JSON.stringify(Object.fromEntries(Object.entries(docs).map(([key, doc]) => [key, { docNumber: doc.docNumber, txnType: doc.txnType, status: doc.status, txnDate: doc.txnDate, lines: doc.lines.map((line) => ({ shareholderName: line.shareholderName, amount: f2(line.amount), wht: f2(line.wht) })) }])), null, 2)).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/declare-pay-reverse`, title: 'DIV_DEC refused without the resolution attachment (V8), posted after the real StorageService took it → Dr 32-1101 / Cr 21-4104; DIV_PAY → Dr 21-4104 / Cr 11-1201 net / Cr 21-3104 WHT with 10% withheld from the individual and the foreign juristic recipient and nothing from the Thai juristic one, explicit WHT respected; payment beyond the declared payable → V_DIV_PAY_LE_PAYABLE; duplicate recipient refused; reverse → mirrored journal, second reverse refused; previous-year payment; maker-checker on → DRAFT not postable, maker cannot post own (403), OWNER posts', documents: ['EQUITY_DOCUMENT'], routes: ['POST /api/equity/documents', 'POST /api/equity/documents/:id/post', 'POST /api/equity/documents/:id/submit', 'POST /api/equity/documents/:id/reverse', 'DELETE /api/equity/documents/:id', 'GET /api/equity/documents/:id', 'GET /api/equity/maker-checker-enabled'], renderer: 'none', artifacts, unverified: ['POST /api/equity/documents/:id/attachments (multipart route): its FileTypeValidator loads the ESM file-type package by dynamic import, which this jest runner cannot do without NODE_OPTIONS=--experimental-vm-modules — the service behind the route was exercised directly instead'] }));
  }, 240000);

  it('dividend register per year and ภ.ง.ด.2 per month: gross / WHT / net / payCount / document numbers per shareholder equal the independent fixture, the reversed payment is gone, the previous year stands alone, individuals only on ภ.ง.ด.2, XLSX exported, identical from either work company', async () => {
    const expected2026 = dividendRegisterExpectation([
      { docNumber: docs.pay1.docNumber, lines: lineSpecs([{ sh: s1, amount: 30000 }, { sh: s2, amount: 20000 }, { sh: s3, amount: 10000 }]) },
      { docNumber: docs.pay2.docNumber, lines: lineSpecs([{ sh: s1, amount: 15000, wht: 1500 }]) },
      { docNumber: docs.pay4.docNumber, lines: lineSpecs([{ sh: s1, amount: 2000 }]) },
    ]);
    const reg2026 = await register(accountant, YEAR);
    expect(reg2026.year).toBe(YEAR);
    const ours = reg2026.rows.filter((row) => mineIds().has(row.shareholderId));
    expect(ours).toHaveLength(3);
    for (const row of ours) {
      const want = expected2026[row.shareholderId];
      expect({ payCount: row.payCount, gross: f2(row.gross), wht: f2(row.wht), net: f2(row.net), docNumbers: [...row.docNumbers].sort() }).toEqual(want);
    }
    const rowOf = (sh: Shareholder) => ours.find((row) => row.shareholderId === sh.id)!;
    expect(rowOf(s1)).toMatchObject({ name: s1.name, taxId: s1.taxId, type: 'INDIVIDUAL', payCount: 3 });
    expect(f2(rowOf(s1).gross)).toBe('47000.00');
    expect(f2(rowOf(s1).wht)).toBe('4700.00');
    expect(rowOf(s2)).toMatchObject({ type: 'JURISTIC_TH', payCount: 1 });
    expect(f2(rowOf(s2).wht)).toBe('0.00');
    expect(rowOf(s2).docNumbers).not.toContain(docs.pay3.docNumber);
    expect(rowOf(s3)).toMatchObject({ taxId: null, type: 'JURISTIC_FOREIGN', payCount: 1 });
    expect(f2(rowOf(s3).wht)).toBe('1000.00');
    expect(reg2026.rows.flatMap((row) => row.docNumbers)).not.toContain(docs.pay3.docNumber);
    // Totals are the sum of the rows returned (nothing dropped or doubled).
    const sum = (rows: RegisterRow[], field: 'gross' | 'wht' | 'net') => rows.reduce((total, row) => total + Number(row[field]), 0).toFixed(2);
    for (const field of ['gross', 'wht', 'net'] as const) expect(f2(reg2026.totals[field])).toBe(sum(reg2026.rows, field));
    expect(sum(ours, 'gross')).toBe('77000.00');
    expect(sum(ours, 'wht')).toBe('5700.00');
    expect(sum(ours, 'net')).toBe('71300.00');

    const reg2025 = await register(accountant, YEAR - 1);
    const ours2025 = reg2025.rows.filter((row) => mineIds().has(row.shareholderId));
    expect(ours2025).toHaveLength(1);
    expect({ id: ours2025[0].shareholderId, payCount: ours2025[0].payCount, gross: f2(ours2025[0].gross), wht: f2(ours2025[0].wht), net: f2(ours2025[0].net), docNumbers: ours2025[0].docNumbers }).toEqual({ id: s1.id, payCount: 1, gross: '8000.00', wht: '800.00', net: '7200.00', docNumbers: [docs.pay0.docNumber] });
    expect((await register(accountant, YEAR - 2)).rows.filter((row) => mineIds().has(row.shareholderId))).toEqual([]);
    expect((await register(accountant, YEAR, 'SHOP')).rows.filter((row) => mineIds().has(row.shareholderId))).toEqual(ours);
    expect((await register(owner, YEAR)).totals).toEqual(reg2026.totals);
    expect((await register(financeManager, YEAR)).totals).toEqual(reg2026.totals);

    // ภ.ง.ด.2 — individuals only, month of payment; the reversed October payment is gone.
    const march = await pnd2(accountant, YEAR, 3);
    const ourMarch = march.items.filter((item) => item.docNumber === docs.pay1.docNumber);
    expect(ourMarch).toHaveLength(1);
    expect(ourMarch[0]).toMatchObject({ shareholderName: s1.name, taxId: s1.taxId, type: 'INDIVIDUAL' });
    expect(f2(ourMarch[0].gross)).toBe('30000.00');
    expect(f2(ourMarch[0].whtAmount)).toBe('3000.00');
    expect(march.items.map((item) => item.shareholderName)).not.toContain(s2.name);
    expect(march.items.map((item) => item.shareholderName)).not.toContain(s3.name);
    expect(f2(march.grossIncome)).toBe(march.items.reduce((total, item) => total + Number(item.gross), 0).toFixed(2));
    expect(march.count).toBe(march.items.length);
    const september = await pnd2(accountant, YEAR, 9);
    expect(september.items.filter((item) => item.docNumber === docs.pay2.docNumber).map((item) => [f2(item.gross), f2(item.whtAmount)])).toEqual([['15000.00', '1500.00']]);
    expect((await pnd2(accountant, YEAR, 10)).items.map((item) => item.docNumber)).not.toContain(docs.pay3.docNumber);
    // superagent only buffers image/pdf/octet-stream bodies on its own — collect the spreadsheet bytes explicitly.
    const binaryParser = (res: NodeJS.ReadableStream, callback: (error: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    };
    const xlsx = await api(accountant).get(`/tax/export-xlsx?form=PND2&year=${YEAR}&month=3`).buffer(true).parse(binaryParser as never).expect(200);
    expect(String(xlsx.headers['content-type'])).toContain('spreadsheet');
    expect(String(xlsx.headers['content-disposition'])).toContain(`PND2-${YEAR}-03.xlsx`);
    const xlsxBytes = xlsx.body as Buffer;
    expect(Buffer.isBuffer(xlsxBytes)).toBe(true);
    expect(xlsxBytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(xlsxBytes.length).toBeGreaterThan(1000);
    const artifacts = [saveArtifact(DOMAIN, 'dividend-register-api.json', JSON.stringify({ [YEAR]: { ours, totals: reg2026.totals, expected: expected2026 }, [YEAR - 1]: ours2025, pnd2March: ourMarch }, null, 2)).relativePath, saveArtifact(DOMAIN, `PND2-${YEAR}-03.xlsx`, xlsxBytes).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/register-and-pnd2`, title: 'GET /equity/dividend-register?year: three recipients, s1 paid three times (47,000 gross / 4,700 WHT incl. an explicit 1,500), Thai juristic 20,000 with 0 WHT, foreign juristic 10,000 with 1,000, reversed payment absent, totals = Σ rows; previous year only s1 8,000 / 800; two years back empty; identical via ?company=shop and for OWNER / FINANCE_MANAGER; ภ.ง.ด.2 March lists only the individual (30,000 / 3,000), September the explicit 1,500, October nothing after the reversal; XLSX PND2 exported', documents: ['DIVIDEND_REGISTER', 'PND2'], routes: ['GET /api/equity/dividend-register', 'GET /api/tax/pnd2-preview', 'GET /api/tax/export-xlsx'], renderer: 'none', artifacts }));
  }, 180000);

  describe('browser — the real admin web app through the Vite proxy', () => {
    it('/finance/dividend-register lists the year, prints landscape, opens one portrait ม.50 ทวิ certificate per shareholder with the FINANCE payer and no carry-over between recipients or years, long names and a missing tax id survive, printing creates no payment, and a missing FINANCE entity is stated plainly', async () => {
      const docCountBefore = await ourDocCount();
      accountantSession = await openAs(world.users.accountant, '/finance/dividend-register');
      const { page, errors } = accountantSession;
      await waitForText(page, s1.name, 'register-rows');
      const table = page.locator('table').first();
      await table.getByText(s3.name).first().waitFor({ state: 'visible', timeout: 30_000 });
      const tableText = await table.innerText();
      for (const token of [s1.name, s2.name, s3.name, s1.taxId!, s2.taxId!, '47,000.00', '4,700.00', '42,300.00', '20,000.00', '10,000.00', '1,000.00', docs.pay1.docNumber, docs.pay2.docNumber, docs.pay4.docNumber]) expect(tableText).toContain(token);
      expect(tableText).not.toContain(docs.pay3.docNumber);
      expect(tableText).not.toContain(docs.pay0.docNumber);
      const screenshots = await shots(page, 'dividend-register');
      const registerPrint = await printToPdf(page, 'dividend-register-print');
      expect(registerPrint.pdf.pages.every(isA4Landscape)).toBe(true);
      expectFonts(registerPrint.pdf);
      for (const token of [s1.name, '47,000.00', docs.pay1.docNumber]) expect(streamText(registerPrint.pdf)).toContain(foldThai(token));

      const rowOf = (name: string) => table.locator('tr').filter({ hasText: name }).first();
      const dialog = page.getByRole('dialog');
      const openCertificate = async (name: string, label: string) => {
        await rowOf(name).getByRole('button', { name: /หนังสือรับรอง/ }).click();
        await dialog.waitFor({ state: 'visible', timeout: 30_000 });
        try {
          await dialog.getByText('หนังสือรับรองการหักภาษี ณ ที่จ่าย').first().waitFor({ timeout: 30_000 });
        } catch (error) {
          saveArtifact(DOMAIN, `failure-${label}.png`, await page.screenshot({ fullPage: true }).catch(() => Buffer.alloc(0)));
          saveArtifact(DOMAIN, `failure-${label}.txt`, `${page.url()}\n\n[dialog]\n${await dialog.innerText().catch(() => '')}`);
          throw new Error(`${label}: certificate did not render — ${String((error as Error).message).split('\n')[0]}`);
        }
        // Let the Radix open animation finish so screenshots show the sheet at full opacity.
        await page.waitForTimeout(400);
        return dialog.innerText();
      };
      const closeCertificate = async () => {
        await dialog.getByRole('button', { name: 'ปิด' }).click();
        await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      };

      // s1 — individual, 3 payments in the year.
      const cert1 = await openCertificate(s1.name, 'certificate-s1');
      for (const token of ['หนังสือรับรองการหักภาษี ณ ที่จ่าย', 'ตามมาตรา 50 ทวิ', 'ภ.ง.ด.2', `ปีภาษี ${YEAR + 543}`, 'ผู้จ่ายเงิน', financeCompany.nameTh, financeCompany.taxId, financeCompany.address, 'ผู้รับเงิน (ผู้ถูกหักภาษี)', s1.name, s1.taxId!, 'เงินปันผล — ม.40(4)(ข)', '47,000.00', '4,700.00', 'ลงชื่อ', financeCompany.directorName]) expect(cert1).toContain(token);
      for (const other of [s2.name, s3.name, '20,000.00', '10,000.00', 'ทดสอบระบบ บริษัทหน้าร้าน']) expect(cert1).not.toContain(other);
      const certShot = saveArtifact(DOMAIN, 'certificate-s1-1440.png', await page.screenshot({ fullPage: true })).relativePath;
      const certPrint = await printToPdf(page, 'certificate-s1-print');
      expect(certPrint.pdf.pageCount).toBe(1);
      expect(certPrint.pdf.pages.every(isA4)).toBe(true);
      expectFonts(certPrint.pdf);
      expect(textSizes(certPrint.pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
      expectInsidePageBox(certPrint.pdf);
      const certStream = streamText(certPrint.pdf);
      for (const token of ['หนังสือรับรองการหักภาษี ณ ที่จ่าย', 'มาตรา 50 ทวิ', financeCompany.nameTh, financeCompany.taxId, s1.name, s1.taxId!, '47,000.00', '4,700.00', 'ลงชื่อ', financeCompany.directorName]) expect(certStream).toContain(foldThai(token));
      for (const other of [s2.name, '20,000.00', 'ทะเบียน']) expect(certStream).not.toContain(foldThai(other));
      expect(pageContaining(certPrint.pdf, 'ลงชื่อ')).toBe(pageContaining(certPrint.pdf, '47,000.00'));
      await closeCertificate();

      // s3 — foreign juristic, very long name, no tax id.
      const cert3 = await openCertificate(s3.name, 'certificate-s3');
      for (const token of [s3.name, 'เลขประจำตัวผู้เสียภาษี: —', '10,000.00', '1,000.00']) expect(cert3).toContain(token);
      for (const other of [s1.name, s1.taxId!, '47,000.00', '4,700.00']) expect(cert3).not.toContain(other);
      const cert3Shot = saveArtifact(DOMAIN, 'certificate-s3-long-name-1440.png', await page.screenshot({ fullPage: true })).relativePath;
      const cert3Print = await printToPdf(page, 'certificate-s3-print');
      expect(cert3Print.pdf.pageCount).toBe(1);
      expect(cert3Print.pdf.pages.every(isA4)).toBe(true);
      expectInsidePageBox(cert3Print.pdf);
      expect(streamText(cert3Print.pdf)).toContain(foldThai('10,000.00'));
      expect(streamText(cert3Print.pdf)).not.toContain(foldThai(s1.taxId!));
      await closeCertificate();

      // s2 — Thai juristic, nothing withheld.
      const cert2 = await openCertificate(s2.name, 'certificate-s2');
      for (const token of [s2.name, s2.taxId!, '20,000.00', '0.00']) expect(cert2).toContain(token);
      expect(cert2).not.toContain(s1.name);
      await closeCertificate();

      // Previous tax year: only s1's 8,000 payment; the certificate follows the year.
      await page.locator('select').first().selectOption(String(YEAR - 1));
      await waitForText(page, '8,000.00', 'register-previous-year');
      const previousText = await table.innerText();
      expect(previousText).toContain(docs.pay0.docNumber);
      expect(previousText).not.toContain(s2.name);
      expect(previousText).not.toContain('47,000.00');
      const cert0 = await openCertificate(s1.name, 'certificate-s1-previous-year');
      for (const token of [`ปีภาษี ${YEAR - 1 + 543}`, s1.name, '8,000.00', '800.00']) expect(cert0).toContain(token);
      expect(cert0).not.toContain('47,000.00');
      const previousShot = saveArtifact(DOMAIN, 'certificate-s1-previous-year-1440.png', await page.screenshot({ fullPage: true })).relativePath;
      await closeCertificate();
      await page.locator('select').first().selectOption(String(YEAR));
      await waitForText(page, '47,000.00', 'register-current-year-again');

      // Printing and browsing created no payment and no journal.
      expect(await ourDocCount()).toBe(docCountBefore);

      // Regression (same defect as DOC-04, fixed in DOC-08): the page called GET /company (no such route) and then fell
      // back to the first company row — with FINANCE missing it would have printed the SHOP identity as the payer.
      const financeRow = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null } });
      await h.prisma.companyInfo.update({ where: { id: financeRow.id }, data: { companyCode: 'FINANCE_HIDDEN_BY_TEST' } });
      let noFinanceShot: string;
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForText(page, s1.name, 'register-no-finance');
        await rowOf(s1.name).getByRole('button', { name: /หนังสือรับรอง/ }).click();
        await dialog.waitFor({ state: 'visible', timeout: 30_000 });
        await dialog.getByText('ไม่พบข้อมูลบริษัทฝั่ง FINANCE').waitFor({ timeout: 30_000 });
        const noFinance = await dialog.innerText();
        expect(noFinance).not.toContain('ทดสอบระบบ บริษัทหน้าร้าน');
        expect(noFinance).not.toContain('หนังสือรับรองการหักภาษี ณ ที่จ่าย');
        expect(await dialog.getByRole('button', { name: 'พิมพ์' }).count()).toBe(0);
        noFinanceShot = saveArtifact(DOMAIN, 'certificate-no-finance-1440.png', await page.screenshot({ fullPage: true })).relativePath;
        await dialog.getByRole('button', { name: 'ปิด' }).click();
        await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      } finally {
        await h.prisma.companyInfo.update({ where: { id: financeRow.id }, data: { companyCode: 'FINANCE' } });
      }
      expect(pageErrors(errors)).toEqual([]);
      const artifacts = [...screenshots, registerPrint.artifact, certShot, certPrint.printMediaShot, certPrint.artifact, cert3Shot, cert3Print.artifact, previousShot, noFinanceShot, saveArtifact(DOMAIN, 'certificate-s1-print.pdf.json', JSON.stringify({ ...pdfSummary(certPrint.pdf), register: pdfSummary(registerPrint.pdf), longName: pdfSummary(cert3Print.pdf), consoleErrors: errors }, null, 2)).relativePath];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-register-and-certificates`, title: 'DividendRegisterPage: register of the year with all three recipients (landscape print), one portrait A4 certificate per recipient — FINANCE payer name / tax id / address / director, ม.50 ทวิ + ภ.ง.ด.2 wording, yearly gross and WHT — recipients switch without carry-over, a 150-character name and a missing tax id (—) stay inside the page box, previous year shows only that year, no payment created by browsing/printing; FINANCE entity missing → plain message, nothing printable (defect: page called a non-existent /company route and fell back to the first company)', documents: ['WHT_CERTIFICATE_50BIS', 'DIVIDEND_REGISTER'], routes: ['POST /api/auth/login', 'GET /api/equity/dividend-register', 'GET /api/companies'], artifacts, notes: consoleNote(errors) }));
    }, 300000);
  });

  it('no outbound side effects — nothing was sent to LINE / SMS / e-mail while declaring, paying, reversing or printing', async () => {
    expect(h.external.calls).toEqual([]);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: 'LINE / SMS / e-mail transports recorded zero calls across the whole domain', routes: [], renderer: 'none', artifacts: [] }));
  });
});
