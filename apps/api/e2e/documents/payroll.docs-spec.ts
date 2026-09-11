/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { DOCUMENT_STYLE, SELF_APPROVAL_DENIED_MESSAGE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld, WorldUser } from './support/fixtures';
import { clearSystemConfig, createWorldUser, fixed2, grantAccountingPermissions, money, setSystemConfig, thaiLongDate, thaiShortDate } from './support/expense-fixtures';
import { createEmployee, createLoginPacer, EmployeeFixture, payrollDocMoney, payrollLineMoney, PayrollLineSpec, syntheticEmployeeId } from './support/payroll-fixtures';
import { recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { foldThai, isA4, isA4Landscape, pageContaining, parsePdf, ParsedPdf, textSizes } from './support/pdf';
import { startWeb, WebRuntime } from './support/web';

/**
 * DOC-04 (issue #1563): payroll → per-employee pay slips → annual ภ.ง.ด.1ก
 * summary and the ม.50 ทวิ certificate, proven through the real API on the
 * disposable database (create / edit draft / post / submit → approve / void),
 * the real PayrollTemplate journal per scope (SHOP vs FINANCE company), the
 * real tax preview + XLSX export, and the real admin web app (Vite proxy +
 * Playwright) for the browser-print entries: /expenses/:id/voucher (one A4 slip
 * per employee) and /finance/wht-annual (table + certificate dialog).
 *
 * Tax rules are the system's own (SSO cap from sso_config, WHT as entered,
 * ม.42 exempt income excluded from the ภ.ง.ด.1 base) — nothing is redefined here.
 */
const DOMAIN = 'payroll';
const GUARDS = [
  'CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard', 'BranchGuard', 'EntityScopeInterceptor', 'AuditInterceptor',
  'accounting_permissions (service-side EXPENSE_POST / EXPENSE_APPROVE / EXPENSE_CANCEL)', 'findOne branch scope + maskPayrollTaxIds (PII by role)',
];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded by the harness, never sent (approval requests fan out IN_APP notifications only)',
  'employees are synthetic users + employee profiles with marked names and synthetic 13-digit ids (start with 7)',
  'pay slips and the 50 ทวิ certificate are browser documents — captured with Chromium print-media page.pdf() of the real pages',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['PAYROLL_SLIP'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

type PayrollLineRow = { id: string; userId: string | null; employeeName: string; employeeTaxId: string | null; baseSalary: string; ssoEmployee: string; whtAmount: string; netPaid: string; customIncome?: Array<{ accountCode: string; name: string; amount: string; isTaxable: boolean }>; customDeduction?: Array<{ accountCode: string; name: string; amount: string }> };
type PayrollDoc = { id: string; number: string; documentType: string; status: string; branchId: string; documentDate: string; paidAt: string | null; subtotal: string; withholdingTax: string; totalAmount: string; netPayment: string | null; depositAccountCode: string | null; journalEntryId: string | null; approvedById: string | null; createdById: string; updatedAt: string; payroll: { payrollPeriod: string; entityScope: string; lines: PayrollLineRow[] } | null };
type JeLine = { accountCode: string; debit: string; credit: string };
type AnnualItem = { employeeName: string; employeeTaxId: string | null; monthsPaid: number; grossTotal: string; whtTotal: string; ssoTotal: string };
type Annual = { form: string; year: number; items: AnnualItem[]; count: number; grossTotal: string; whtTotal: string; annualWageTotal: string };

const YEAR = 2026;
const P1 = { period: '2026-07', date: '2026-07-25' };
const P2 = { period: '2026-08', date: '2026-08-25' };
const P3 = { period: '2026-09', date: '2026-09-10' };
const SHOP_BANK = 'S11-1202';
const FINANCE_BANK = '11-1201';

describe('DOC-04 payroll slips and annual 50 ทวิ — real workflow, real journal per scope, real tax preview and print entries', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let web: WebRuntime | null = null;
  let owner: Session, accountant: Session, financeManager: Session, branchManagerA: Session, branchManagerB: Session, salesA: Session;
  let branchManagerBUser: WorldUser;
  let e1: EmployeeFixture, e2: EmployeeFixture, e4: EmployeeFixture, resigned: EmployeeFixture;
  const E3_NAME = () => `ทดสอบระบบ พนักงานรายวัน ไม่มีเลขภาษี ${world.prefix}`;
  let shopCompanyId: string, financeCompanyId: string;
  const docs: { p1?: PayrollDoc; p2?: PayrollDoc; p3?: PayrollDoc; fin?: PayrollDoc } = {};
  const pace = createLoginPacer();

  // Independent money: the same three SHOP employees paid twice, one FINANCE employee once, one SHOP month voided.
  const p1Lines = (): PayrollLineSpec[] => [
    { baseSalary: 18000, ssoEmployee: 875, whtAmount: 150, customIncome: [{ accountCode: 'S52-1202', name: 'ค่าล่วงเวลา', amount: 1000, isTaxable: true }] },
    { baseSalary: 12000, ssoEmployee: 600, whtAmount: 0, customIncome: [{ accountCode: 'S52-1204', name: 'เบี้ยเลี้ยงเดินทาง', amount: 500, isTaxable: false }], customDeduction: [{ accountCode: 'S21-1103', name: 'คืนเงินยืม', amount: 500 }] },
    { baseSalary: 9000, ssoEmployee: 450, whtAmount: 0 },
  ];
  const p2Lines = (): PayrollLineSpec[] => [
    { baseSalary: 18000, ssoEmployee: 875, whtAmount: 200 },
    { baseSalary: 12000, ssoEmployee: 600, whtAmount: 0 },
    { baseSalary: 9000, ssoEmployee: 450, whtAmount: 0 },
  ];
  const p3Lines = (): PayrollLineSpec[] => [{ baseSalary: 18000, ssoEmployee: 875, whtAmount: 200 }];
  const finLines = (): PayrollLineSpec[] => [{ baseSalary: 25000, ssoEmployee: 875, whtAmount: 500, customIncome: [{ accountCode: '53-1104', name: 'โบนัส', amount: 3000, isTaxable: true }] }];

  const api = (session: Session | null, company?: 'SHOP' | 'FINANCE' | null) => h.client({ session, company });
  const getDoc = async (session: Session, id: string): Promise<PayrollDoc> => (await api(session).get(`/expense-documents/${id}`).expect(200)).body.data;
  const shopLine = (spec: PayrollLineSpec, employee: EmployeeFixture | { employeeName: string }) => ({ ...spec, ...('user' in employee ? { userId: employee.user.id } : { employeeName: employee.employeeName }) });
  const createPayroll = (session: Session, body: Record<string, unknown>) => api(session).post('/expense-documents/payroll', body);
  const postDoc = (session: Session, id: string) => api(session).post(`/expense-documents/${id}/post`);
  const journalLines = async (journalEntryId: string): Promise<JeLine[]> => {
    const rows = await h.prisma.journalLine.findMany({ where: { journalEntryId, deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { accountCode: 'asc' }] });
    return rows.map((row) => ({ accountCode: row.accountCode, debit: fixed2(row.debit), credit: fixed2(row.credit) }));
  };
  const balanced = (lines: JeLine[]) => ({ debit: lines.reduce((sum, line) => sum + Number(line.debit), 0).toFixed(2), credit: lines.reduce((sum, line) => sum + Number(line.credit), 0).toFixed(2) });
  const payrollJeCount = () => h.prisma.journalEntry.count({ where: { deletedAt: null, metadata: { path: ['flow'], equals: 'expense-payroll' } as never } });
  const annual = async (session: Session, year = YEAR, company?: 'SHOP' | 'FINANCE' | null): Promise<Annual> => (await api(session, company).get(`/tax/pnd1-annual-preview?year=${year}`).expect(200)).body.data;
  const ours = (items: AnnualItem[]) => items.filter((item) => item.employeeName.includes(world.prefix) || item.employeeName.includes('ทดสอบระบบ พนักงาน'));
  const pdfSummary = (pdf: ParsedPdf) => ({ pageCount: pdf.pageCount, pages: pdf.pages.map((page) => ({ index: page.index, widthPt: +page.widthPt.toFixed(2), heightPt: +page.heightPt.toFixed(2), lines: page.lines.length, textItems: page.items.filter((item) => item.str.trim()).length })), fonts: pdf.fonts, sizes: textSizes(pdf) });
  const pageStream = (pdf: ParsedPdf, index: number) => foldThai(pdf.pages[index - 1].items.map((item) => item.str).join(''));
  const streamText = (pdf: ParsedPdf) => foldThai(pdf.pages.map((page) => page.items.map((item) => item.str).join('')).join('\n'));

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
    // The print stylesheet swaps every element to TH Sarabun PSK; printing in the same frame as
    // the media switch yields a PDF with layout but no text runs (found by the DOC-03 sessions).
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
    branchManagerBUser = await createWorldUser(h.prisma, world, 'manager-b', 'BRANCH_MANAGER', world.branches.b.id);
    await grantAccountingPermissions(h.prisma, world.users.accountant.id, ['EXPENSE_POST', 'EXPENSE_APPROVE', 'EXPENSE_CANCEL']);
    await grantAccountingPermissions(h.prisma, world.users.financeManager.id, ['EXPENSE_POST', 'EXPENSE_APPROVE']);
    e1 = await createEmployee(h.prisma, world, 'e1', { branchId: world.branches.a.id, nationalId: syntheticEmployeeId(1), position: 'พนักงานขาย', baseSalary: 18000, bank: { bankName: 'ธนาคารกสิกรไทย', bankAccountNo: '0000000001' } });
    e2 = await createEmployee(h.prisma, world, 'e2', { branchId: world.branches.a.id, nationalId: syntheticEmployeeId(2), taxIdOverride: syntheticEmployeeId(22), position: 'ช่างเทคนิค', baseSalary: 12000, bank: { bankName: 'ธนาคารไทยพาณิชย์', bankAccountNo: '0000000002' } });
    e4 = await createEmployee(h.prisma, world, 'e4', { branchId: world.branches.a.id, role: 'ACCOUNTANT', nationalId: syntheticEmployeeId(4), position: 'พนักงานบัญชี (ส่วนกลาง)', baseSalary: 25000 });
    resigned = await createEmployee(h.prisma, world, 'resigned', { branchId: world.branches.a.id, nationalId: syntheticEmployeeId(5), resignedDate: new Date('2026-01-31') });
    shopCompanyId = (await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } })).id;
    financeCompanyId = (await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null } })).id;
    for (const [key, user] of [['owner', world.users.owner], ['accountant', world.users.accountant], ['financeManager', world.users.financeManager], ['branchManagerA', world.users.branchManagerA], ['branchManagerB', branchManagerBUser], ['salesA', world.users.salesA]] as const) {
      await pace();
      const session = await h.login(user.email, user.password);
      if (key === 'owner') owner = session; else if (key === 'accountant') accountant = session; else if (key === 'financeManager') financeManager = session;
      else if (key === 'branchManagerA') branchManagerA = session; else if (key === 'branchManagerB') branchManagerB = session; else salesA = session;
    }
  }, 180000);

  afterAll(async () => {
    await web?.close();
    await h?.close();
  });

  it('serves the payroll form meta per scope: income whitelist and cash accounts come from the real chart', async () => {
    const shop = (await api(accountant).get('/expense-documents/payroll/meta?scope=SHOP').expect(200)).body.data;
    const finance = (await api(accountant).get('/expense-documents/payroll/meta?scope=FINANCE').expect(200)).body.data;
    expect(shop.incomeWhitelist.map((row: { code: string }) => row.code)).toEqual(['S52-1202', 'S52-1204']);
    expect(shop.cashAccounts.map((row: { code: string }) => row.code)).toContain(SHOP_BANK);
    expect(finance.incomeWhitelist.map((row: { code: string }) => row.code)).toEqual(['53-1103', '53-1104']);
    expect(finance.cashAccounts.map((row: { code: string }) => row.code)).toContain(FINANCE_BANK);
    expect(shop.incomeWhitelist.every((row: { name: string }) => row.name.length > 0)).toBe(true);
    await api(salesA).get('/expense-documents/payroll/meta?scope=SHOP').expect(403);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/payroll-meta`, title: 'GET /expense-documents/payroll/meta per scope: SHOP → S52-1202/S52-1204 + S11 accounts, FINANCE → 53-1103/53-1104 + 11 accounts, names from CoA; SALES 403', routes: ['GET /api/expense-documents/payroll/meta'], renderer: 'none', artifacts: [] }));
  });

  it('rejects invalid payroll input through the real validators (scope↔account, duplicates, SSO cap, whitelist, deductions, registry, period format, branch, role)', async () => {
    const base = { branchId: world.branches.a.id, documentDate: P1.date, payrollPeriod: P1.period, entityScope: 'SHOP', depositAccountCode: SHOP_BANK, paymentMethod: 'BANK_TRANSFER' };
    const expect400 = async (body: Record<string, unknown>, pattern: RegExp) => {
      const response = await createPayroll(accountant, body).expect(400);
      const message = Array.isArray(response.body.message) ? response.body.message.join(' ') : String(response.body.message);
      expect(message).toMatch(pattern);
    };
    await expect400({ ...base, depositAccountCode: FINANCE_BANK, lines: [shopLine({ baseSalary: 1000 }, e1)] }, /S11-XXXX/);
    await expect400({ ...base, entityScope: 'FINANCE', lines: [shopLine({ baseSalary: 1000 }, e1)] }, /11-XXXX/);
    await expect400({ ...base, lines: [shopLine({ baseSalary: 1000 }, e1), shopLine({ baseSalary: 2000 }, e1)] }, /ซ้ำ/);
    await expect400({ ...base, lines: [shopLine({ baseSalary: 20000, ssoEmployee: 900 }, e1)] }, /SSO ต่อคนไม่เกิน 875\.00/);
    await expect400({ ...base, lines: [shopLine({ baseSalary: 1000, customIncome: [{ accountCode: 'S52-1201', name: 'ผิดบัญชี', amount: 10 }] }, e1)] }, /V17/);
    await expect400({ ...base, lines: [shopLine({ baseSalary: 1000, customDeduction: [{ accountCode: '21-1103', name: 'ผิดฝั่ง', amount: 10 }] }, e1)] }, /V19/);
    await expect400({ ...base, lines: [shopLine({ baseSalary: 1000, customDeduction: [{ accountCode: 'S21-1103', name: 'หักเกิน', amount: 1500 }] }, e1)] }, /V18/);
    await expect400({ ...base, lines: [{ baseSalary: 1000 }] }, /เลือกพนักงานจากทะเบียน|ชื่อพนักงาน/);
    await expect400({ ...base, lines: [shopLine({ baseSalary: 1000 }, resigned)] }, /ไม่อยู่ในทะเบียนพนักงาน/);
    await expect400({ ...base, lines: [{ userId: world.users.salesB.id, baseSalary: 1000 }] }, /ไม่อยู่ในทะเบียนพนักงาน/);
    await expect400({ ...base, payrollPeriod: '2569-07', lines: [shopLine({ baseSalary: 1000 }, e1)] }, /YYYY-MM/);
    await createPayroll(branchManagerB, { ...base, lines: [shopLine({ baseSalary: 1000 }, e1)] }).expect(403);
    await createPayroll(salesA, { ...base, lines: [shopLine({ baseSalary: 1000 }, e1)] }).expect(403);
    expect(await h.prisma.expenseDocument.count({ where: { documentType: 'PAYROLL' } })).toBe(0);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/validation`, title: 'POST /expense-documents/payroll: scope↔cash account, duplicate employee, SSO over the period cap (875), V17 income whitelist, V19 deduction scope, V18 deduction > gross, free-text line without a name, resigned / unregistered employee, BE period, other-branch BRANCH_MANAGER 403, SALES 403 — nothing persisted', routes: ['POST /api/expense-documents/payroll'], renderer: 'none', artifacts: [], notes: 'SSO cap read from sso_config (migration 20260927000000): 875 ฿ for 2026' }));
  });

  it('creates, edits and posts a SHOP payroll for three employees (linked + free-text, taxable + exempt income, deduction) and books the SHOP journal', async () => {
    const draft = (await createPayroll(accountant, { branchId: world.branches.a.id, documentDate: P1.date, payrollPeriod: P1.period, entityScope: 'SHOP', depositAccountCode: SHOP_BANK, paymentMethod: 'BANK_TRANSFER', description: 'ทดสอบระบบ เงินเดือนสาขา A งวดแรก', lines: [shopLine(p1Lines()[0], e1), shopLine(p1Lines()[1], e2), shopLine({ baseSalary: 8000, ssoEmployee: 400 }, { employeeName: E3_NAME() })] }).expect(201)).body.data as PayrollDoc;
    expect(draft.status).toBe('DRAFT');
    expect(draft.number).toMatch(/^PR-2607-\d{3,}$/);
    expect(draft.payroll!.entityScope).toBe('SHOP');
    // Draft edit replaces the line set (R3-2) — the free-text employee gets the final base salary.
    const edited = (await api(accountant).patch(`/expense-documents/${draft.id}/payroll`, { documentDate: P1.date, payrollPeriod: P1.period, entityScope: 'SHOP', depositAccountCode: SHOP_BANK, paymentMethod: 'BANK_TRANSFER', lines: [shopLine(p1Lines()[0], e1), shopLine(p1Lines()[1], e2), shopLine(p1Lines()[2], { employeeName: E3_NAME() })] }).expect(200)).body.data as PayrollDoc;
    const expected = payrollDocMoney(p1Lines());
    const lineMoney = p1Lines().map(payrollLineMoney);
    expect(edited.payroll!.lines).toHaveLength(3);
    const byName = (name: string) => edited.payroll!.lines.find((line) => line.employeeName === name)!;
    const l1 = byName(`ทดสอบระบบ พนักงาน e1`), l2 = byName(`ทดสอบระบบ พนักงาน e2`), l3 = byName(E3_NAME());
    // Registry snapshot: linked lines take name + tax id from the employee record (profile override wins); free text keeps what was typed.
    expect(l1.userId).toBe(e1.user.id);
    expect(l1.employeeTaxId).toBe(e1.nationalId);
    expect(l2.employeeTaxId).toBe(e2.taxId);
    expect(l3.userId).toBeNull();
    expect(l3.employeeTaxId).toBeNull();
    expect([fixed2(l1.netPaid), fixed2(l2.netPaid), fixed2(l3.netPaid)]).toEqual(lineMoney.map((line) => fixed2(line.net)));
    expect(fixed2(l1.netPaid)).toBe('17975.00');
    expect(fixed2(l2.netPaid)).toBe('11400.00');
    expect(fixed2(l3.netPaid)).toBe('8550.00');
    expect(l2.customIncome!.map((row) => [row.accountCode, row.isTaxable])).toEqual([['S52-1204', false]]);
    expect(l2.customDeduction!.map((row) => [row.accountCode, fixed2(row.amount)])).toEqual([['S21-1103', '500.00']]);
    expect(fixed2(edited.subtotal)).toBe(fixed2(expected.subtotal));
    expect(fixed2(edited.withholdingTax)).toBe(fixed2(expected.wht));
    expect(fixed2(edited.netPayment!)).toBe(fixed2(expected.net));
    expect(fixed2(edited.netPayment!)).toBe('37925.00');
    // Duplicate period for the same branch + scope is refused while this document lives.
    const duplicate = await createPayroll(accountant, { branchId: world.branches.a.id, documentDate: P1.date, payrollPeriod: P1.period, entityScope: 'SHOP', depositAccountCode: SHOP_BANK, lines: [shopLine({ baseSalary: 1000 }, e1)] }).expect(400);
    expect(duplicate.body.message).toContain(draft.number);

    await postDoc(salesA, draft.id).expect(403);
    await postDoc(branchManagerB, draft.id).expect(403);
    await postDoc(accountant, draft.id).expect(201);
    const doc = await getDoc(accountant, draft.id);
    docs.p1 = doc;
    expect(doc.status).toBe('POSTED');
    expect(doc.paidAt).not.toBeNull();
    const je = await h.prisma.journalEntry.findUniqueOrThrow({ where: { id: doc.journalEntryId! } });
    expect(je.companyId).toBe(shopCompanyId);
    expect((je.metadata as { entityScope?: string; employeeCount?: number }).entityScope).toBe('SHOP');
    expect((je.metadata as { employeeCount?: number }).employeeCount).toBe(3);
    const lines = await journalLines(doc.journalEntryId!);
    expect(lines).toEqual(expect.arrayContaining([
      { accountCode: 'S52-1201', debit: fixed2(expected.subtotal), credit: '0.00' },
      { accountCode: 'S52-1205', debit: fixed2(expected.sso), credit: '0.00' },
      { accountCode: 'S52-1202', debit: '1000.00', credit: '0.00' },
      { accountCode: 'S52-1204', debit: '500.00', credit: '0.00' },
      { accountCode: 'S21-3101', debit: '0.00', credit: fixed2(expected.wht) },
      { accountCode: 'S21-3105', debit: '0.00', credit: fixed2(expected.sso) },
      { accountCode: 'S21-3106', debit: '0.00', credit: fixed2(expected.sso) },
      { accountCode: 'S21-1103', debit: '0.00', credit: '500.00' },
      { accountCode: SHOP_BANK, debit: '0.00', credit: fixed2(expected.net) },
    ]));
    expect(lines).toHaveLength(9);
    expect(lines.every((line) => line.accountCode.startsWith('S'))).toBe(true);
    expect(balanced(lines)).toEqual({ debit: '42425.00', credit: '42425.00' });
    const artifact = saveArtifact(DOMAIN, 'payroll-p1.json', JSON.stringify({ document: doc, expected: { subtotal: fixed2(expected.subtotal), sso: fixed2(expected.sso), wht: fixed2(expected.wht), net: fixed2(expected.net), incomeByAccount: expected.incomeByAccount, deductionByAccount: expected.deductionByAccount, lines: lineMoney.map((line) => ({ net: fixed2(line.net), gross: fixed2(line.gross) })) }, journal: lines }, null, 2)).relativePath;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/shop-payroll-post`, title: 'SHOP payroll 2026-07: create → PATCH draft (lines replaced) → POST; linked lines snapshot name/tax id from the registry (profile override wins), free-text line keeps null tax id; per-line net and header totals equal the independent fixture; JE on the SHOP company: 9 lines all S-codes, balanced 42,425', documents: ['PAYROLL_SLIP', 'PAYROLL'], routes: ['POST /api/expense-documents/payroll', 'PATCH /api/expense-documents/:id/payroll', 'POST /api/expense-documents/:id/post', 'GET /api/expense-documents/:id'], renderer: 'none', artifacts: [artifact] }));
  });

  it('routes the second month through the approval workflow (payroll is an approval-required type) and pays the FINANCE employee on the FINANCE books', async () => {
    await setSystemConfig(h.prisma, 'approval_enabled', 'true');
    try {
      const draft = (await createPayroll(accountant, { branchId: world.branches.a.id, documentDate: P2.date, payrollPeriod: P2.period, entityScope: 'SHOP', depositAccountCode: SHOP_BANK, paymentMethod: 'BANK_TRANSFER', lines: [shopLine(p2Lines()[0], e1), shopLine(p2Lines()[1], e2), shopLine(p2Lines()[2], { employeeName: E3_NAME() })] }).expect(201)).body.data as PayrollDoc;
      const blocked = await postDoc(accountant, draft.id).expect(400);
      expect(blocked.body.message).toContain('ต้องผ่านการอนุมัติก่อน');
      await api(accountant).post(`/expense-documents/${draft.id}/submit-for-approval`).expect(201);
      const self = await api(accountant).post(`/expense-documents/${draft.id}/approve`).expect(403);
      expect(self.body.message).toBe(SELF_APPROVAL_DENIED_MESSAGE);
      await api(financeManager).post(`/expense-documents/${draft.id}/approve`).expect(201);
      const doc = await getDoc(accountant, draft.id);
      docs.p2 = doc;
      expect(doc.status).toBe('POSTED');
      expect(doc.approvedById).toBe(world.users.financeManager.id);
      const expected = payrollDocMoney(p2Lines());
      const lines = await journalLines(doc.journalEntryId!);
      expect(lines).toEqual(expect.arrayContaining([
        { accountCode: 'S52-1201', debit: '39000.00', credit: '0.00' },
        { accountCode: 'S21-3101', debit: '0.00', credit: '200.00' },
        { accountCode: SHOP_BANK, debit: '0.00', credit: fixed2(expected.net) },
      ]));
      expect(lines).toHaveLength(6);
      expect(balanced(lines)).toEqual({ debit: '40925.00', credit: '40925.00' });

      // FINANCE scope: bare-digit chart, FINANCE company, FINANCE bank account.
      const fin = (await createPayroll(accountant, { branchId: world.branches.a.id, documentDate: '2026-08-28', payrollPeriod: P2.period, entityScope: 'FINANCE', depositAccountCode: FINANCE_BANK, paymentMethod: 'BANK_TRANSFER', lines: [shopLine(finLines()[0], e4)] }).expect(201)).body.data as PayrollDoc;
      await api(accountant).post(`/expense-documents/${fin.id}/submit-for-approval`).expect(201);
      await api(financeManager).post(`/expense-documents/${fin.id}/approve`).expect(201);
      const finDoc = await getDoc(accountant, fin.id);
      docs.fin = finDoc;
      expect(finDoc.status).toBe('POSTED');
      const finJe = await h.prisma.journalEntry.findUniqueOrThrow({ where: { id: finDoc.journalEntryId! } });
      expect(finJe.companyId).toBe(financeCompanyId);
      const finLinesJe = await journalLines(finDoc.journalEntryId!);
      expect(finLinesJe).toEqual(expect.arrayContaining([
        { accountCode: '53-1101', debit: '25000.00', credit: '0.00' },
        { accountCode: '53-1102', debit: '875.00', credit: '0.00' },
        { accountCode: '53-1104', debit: '3000.00', credit: '0.00' },
        { accountCode: '21-3101', debit: '0.00', credit: '500.00' },
        { accountCode: '21-3105', debit: '0.00', credit: '875.00' },
        { accountCode: '21-3106', debit: '0.00', credit: '875.00' },
        { accountCode: FINANCE_BANK, debit: '0.00', credit: '26625.00' },
      ]));
      expect(finLinesJe.every((line) => !line.accountCode.startsWith('S'))).toBe(true);
      expect(balanced(finLinesJe)).toEqual({ debit: '28875.00', credit: '28875.00' });
      const artifact = saveArtifact(DOMAIN, 'payroll-p2-and-finance.json', JSON.stringify({ shop: { document: doc, journal: lines }, finance: { document: finDoc, journal: finLinesJe } }, null, 2)).relativePath;
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/approval-and-finance-scope`, title: 'approval_enabled: PAYROLL cannot be posted from DRAFT, maker cannot approve, FINANCE_MANAGER approves → auto-posted; FINANCE-scope payroll books 53-1101/53-1102/53-1104 + 21-31xx + 11-1201 on the FINANCE company (28,875 balanced)', documents: ['PAYROLL'], routes: ['POST /api/expense-documents/payroll', 'POST /api/expense-documents/:id/post', 'POST /api/expense-documents/:id/submit-for-approval', 'POST /api/expense-documents/:id/approve'], renderer: 'none', artifacts: [artifact] }));
    } finally {
      await clearSystemConfig(h.prisma, 'approval_enabled');
    }
  });

  it('voids a posted month with a mirrored reversal and keeps a draft month out of the books', async () => {
    const p3 = (await createPayroll(accountant, { branchId: world.branches.a.id, documentDate: P3.date, payrollPeriod: P3.period, entityScope: 'SHOP', depositAccountCode: SHOP_BANK, paymentMethod: 'BANK_TRANSFER', lines: [shopLine(p3Lines()[0], e1)] }).expect(201)).body.data as PayrollDoc;
    await postDoc(accountant, p3.id).expect(201);
    const before = await getDoc(accountant, p3.id);
    await api(branchManagerA).post(`/expense-documents/${p3.id}/void`, { reasonCode: 'data_entry_error' }).expect(403);
    await api(accountant).post(`/expense-documents/${p3.id}/void`, { reasonCode: 'data_entry_error' }).expect(201);
    const voided = await getDoc(accountant, p3.id);
    docs.p3 = voided;
    expect(voided.status).toBe('VOIDED');
    const original = await journalLines(before.journalEntryId!);
    const reversal = await h.prisma.journalEntry.findFirst({ where: { referenceType: 'AUTO', referenceId: `${p3.id}:reversal`, deletedAt: null } });
    expect(reversal).not.toBeNull();
    expect((await journalLines(reversal!.id)).map((line) => ({ accountCode: line.accountCode, debit: line.credit, credit: line.debit }))).toEqual(expect.arrayContaining(original));
    // A fresh draft for the same period is allowed again once the old one is VOIDED — and stays out of every report until posted.
    const redo = (await createPayroll(accountant, { branchId: world.branches.a.id, documentDate: P3.date, payrollPeriod: P3.period, entityScope: 'SHOP', depositAccountCode: SHOP_BANK, lines: [shopLine(p3Lines()[0], e1)] }).expect(201)).body.data as PayrollDoc;
    expect(redo.status).toBe('DRAFT');
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/void-and-draft`, title: 'POSTED payroll 2026-09 voided by EXPENSE_CANCEL → mirrored reversal JE; BRANCH_MANAGER without the grant 403; a new DRAFT for the voided period is accepted and excluded from ภ.ง.ด.1ก until posted', documents: ['PAYROLL'], routes: ['POST /api/expense-documents/:id/void', 'POST /api/expense-documents/payroll'], renderer: 'none', artifacts: [] }));
  });

  it('aggregates the annual ภ.ง.ด.1ก per employee from POSTED payrolls only (taxable income in, ม.42 exempt out, drafts and voids out) and exports it as XLSX', async () => {
    const data = await annual(accountant);
    const items = ours(data.items);
    expect(items).toHaveLength(4);
    const byName = (name: string) => items.find((item) => item.employeeName === name)!;
    const a1 = byName('ทดสอบระบบ พนักงาน e1'), a2 = byName('ทดสอบระบบ พนักงาน e2'), a3 = byName(E3_NAME()), a4 = byName('ทดสอบระบบ พนักงาน e4');
    const m = (spec: PayrollLineSpec) => payrollLineMoney(spec);
    expect([a1.employeeTaxId, a1.monthsPaid, fixed2(a1.grossTotal), fixed2(a1.whtTotal), fixed2(a1.ssoTotal)]).toEqual([e1.nationalId, 2, fixed2(m(p1Lines()[0]).gross.plus(m(p2Lines()[0]).gross)), '350.00', '1750.00']);
    expect(fixed2(a1.grossTotal)).toBe('37000.00');
    expect([a2.employeeTaxId, a2.monthsPaid, fixed2(a2.grossTotal), fixed2(a2.whtTotal), fixed2(a2.ssoTotal)]).toEqual([e2.taxId, 2, '24000.00', '0.00', '1200.00']);
    expect([a3.employeeTaxId, a3.monthsPaid, fixed2(a3.grossTotal), fixed2(a3.whtTotal), fixed2(a3.ssoTotal)]).toEqual([null, 2, '18000.00', '0.00', '900.00']);
    expect([a4.employeeTaxId, a4.monthsPaid, fixed2(a4.grossTotal), fixed2(a4.whtTotal), fixed2(a4.ssoTotal)]).toEqual([e4.nationalId, 1, '28000.00', '500.00', '875.00']);
    expect(fixed2(data.grossTotal)).toBe('107000.00');
    expect(fixed2(data.whtTotal)).toBe('850.00');
    expect(fixed2(data.annualWageTotal)).toBe(fixed2(data.grossTotal));
    expect(data.count).toBe(4);
    // The certificate page reads the issuer from GET /companies — the synthetic FINANCE identity must be there, unmasked.
    const companies = (await api(accountant).get('/companies').expect(200)).body.data as Array<{ companyCode: string | null; nameTh: string; taxId: string; address: string; directorName: string }>;
    const finance = companies.find((row) => row.companyCode === 'FINANCE')!;
    expect(finance).toMatchObject({ nameTh: 'ทดสอบระบบ บริษัทไฟแนนซ์', taxId: '0000000000000', address: 'ข้อมูลทดสอบระบบ — ลบได้', directorName: 'ทดสอบระบบ ผู้ลงนาม' });
    // Company-wide: the same answer whichever work company the caller is in; a different year is empty.
    expect((await annual(accountant, YEAR, 'SHOP')).items).toEqual(data.items);
    expect((await annual(accountant, YEAR, 'FINANCE')).items).toEqual(data.items);
    expect(ours((await annual(accountant, YEAR - 1)).items)).toEqual([]);
    // Monthly ภ.ง.ด.1 of the SHOP company for 2026-07 carries the taxable gross of the three SHOP employees.
    const monthly = (await api(accountant).get(`/tax/pnd1-preview?companyId=${shopCompanyId}&year=2026&month=7`).expect(200)).body.data;
    const monthlyOurs = (monthly.items as Array<{ employeeName: string; gross: string; whtAmount: string }>).filter((item) => item.employeeName.includes('ทดสอบระบบ'));
    expect(monthlyOurs).toHaveLength(3);
    expect(fixed2(monthlyOurs.find((item) => item.employeeName === 'ทดสอบระบบ พนักงาน e1')!.gross)).toBe('19000.00');
    expect(fixed2(monthlyOurs.find((item) => item.employeeName === 'ทดสอบระบบ พนักงาน e2')!.gross)).toBe('12000.00');
    // XLSX export of the annual form.
    const xlsx = await api(accountant).get(`/tax/export-xlsx?form=PND1A&year=${YEAR}`).expect(200).expect('Content-Type', /spreadsheetml/);
    const bytes = bodyBuffer(xlsx);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.headers['content-disposition']).toContain(`PND1A-${YEAR}.xlsx`);
    const artifacts = [saveArtifact(DOMAIN, 'pnd1-annual.json', JSON.stringify({ annual: data, monthlyJuly: monthlyOurs }, null, 2)).relativePath, saveArtifact(DOMAIN, `PND1A-${YEAR}.xlsx`, bytes).relativePath];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/annual-pnd1a`, title: 'GET /tax/pnd1-annual-preview: 4 employees, months paid 2/2/2/1, gross = base + taxable extras (per-diem ม.42 excluded), WHT and SSO summed across months, DRAFT/VOIDED months excluded, tax id from the registry (override wins, free text null); identical across ?company=; XLSX PND1A exported', documents: ['PND1A', 'WHT_CERTIFICATE_50BIS'], routes: ['GET /api/tax/pnd1-annual-preview', 'GET /api/tax/pnd1-preview', 'GET /api/tax/export-xlsx'], renderer: 'none', artifacts }));
  });

  it('keeps payroll data and files away from roles without payroll/tax rights, masks tax ids by role, and re-reading or re-printing changes nothing in the books', async () => {
    const doc = docs.p1!;
    for (const path of [`/expense-documents/${doc.id}`, `/expense-documents/${doc.id}/bank-transfer.csv`, `/tax/pnd1-annual-preview?year=${YEAR}`, `/tax/export-xlsx?form=PND1A&year=${YEAR}`, `/expense-documents/${doc.id}/voucher.pdf`]) {
      const denied = await api(salesA).get(path).expect(403);
      expect(denied.headers['content-type']).toMatch(/json/);
    }
    await api(branchManagerB).get(`/expense-documents/${doc.id}`).expect(403);
    await api(branchManagerB).get(`/expense-documents/${doc.id}/voucher.pdf`).expect(403);
    await api(branchManagerA).get(`/expense-documents/${doc.id}/bank-transfer.csv`).expect(403);
    await api(branchManagerA).get(`/tax/pnd1-annual-preview?year=${YEAR}`).expect(403);
    await api(branchManagerA).get(`/tax/export-xlsx?form=PND1A&year=${YEAR}`).expect(403);
    // PII: the branch manager of the payroll's own branch reads the document, but tax ids are masked; accountants get them in full.
    const masked = await getDoc(branchManagerA, doc.id);
    expect(masked.payroll!.lines.find((line) => line.userId === e1.user.id)!.employeeTaxId).toBe(`•••••••••${e1.nationalId.slice(-4)}`);
    expect(masked.payroll!.lines.find((line) => line.userId === e2.user.id)!.employeeTaxId).toBe(`•••••••••${e2.taxId.slice(-4)}`);
    expect(masked.payroll!.lines.find((line) => line.userId === null)!.employeeTaxId).toBeNull();
    expect((await getDoc(accountant, doc.id)).payroll!.lines.find((line) => line.userId === e1.user.id)!.employeeTaxId).toBe(e1.nationalId);
    // Bank transfer file: linked employees with bank data, free-text line skipped and reported.
    const csv = await api(accountant).get(`/expense-documents/${doc.id}/bank-transfer.csv`).expect(200).expect('Content-Type', /text\/csv/);
    expect(csv.headers['x-skipped-lines']).toBe('1');
    expect(csv.headers['content-disposition']).toContain(`bank-transfer-${doc.number}.csv`);
    const text = bodyBuffer(csv).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const rows = text.slice(1).trim().split('\r\n');
    expect(rows[0]).toBe('ลำดับ,ชื่อพนักงาน,ธนาคาร,เลขบัญชี,จำนวนเงิน');
    expect(rows.slice(1)).toEqual(expect.arrayContaining([`1,ทดสอบระบบ พนักงาน e1,ธนาคารกสิกรไทย,0000000001,17975.00`, `2,ทดสอบระบบ พนักงาน e2,ธนาคารไทยพาณิชย์,0000000002,11400.00`]));
    expect(rows).toHaveLength(3);
    // Re-reading, re-printing and re-exporting are side-effect free.
    const jeBefore = await payrollJeCount();
    const docBefore = await h.prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    for (let round = 0; round < 2; round += 1) {
      await getDoc(accountant, doc.id);
      await api(accountant).get(`/expense-documents/${doc.id}/voucher.pdf`).expect(200).expect('Content-Type', /application\/pdf/);
      await annual(accountant);
      await api(accountant).get(`/expense-documents/${doc.id}/bank-transfer.csv`).expect(200);
    }
    await postDoc(accountant, doc.id).expect(400);
    expect(await payrollJeCount()).toBe(jeBefore);
    const docAfter = await h.prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(docAfter.updatedAt.toISOString()).toBe(docBefore.updatedAt.toISOString());
    expect(docAfter.journalEntryId).toBe(docBefore.journalEntryId);
    expect(await h.prisma.payment.count({ where: { createdAt: { gte: docBefore.createdAt } } })).toBe(0);
    const artifact = saveArtifact(DOMAIN, `bank-transfer-${doc.number}.csv`, bodyBuffer(csv)).relativePath;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/authorization-pii-idempotence`, title: 'SALES 403 on document/CSV/annual/XLSX/voucher; BRANCH_MANAGER of another branch 403; own-branch BRANCH_MANAGER sees masked tax ids and no CSV/annual; bank CSV lists linked employees with bank data (free text skipped, X-Skipped-Lines 1); two rounds of read/print/export + a second post leave the document, its JE count and payments untouched', routes: ['GET /api/expense-documents/:id', 'GET /api/expense-documents/:id/bank-transfer.csv', 'GET /api/expense-documents/:id/voucher.pdf', 'GET /api/tax/pnd1-annual-preview', 'GET /api/tax/export-xlsx', 'POST /api/expense-documents/:id/post'], renderer: 'none', artifacts: [artifact], notes: 'GET :id/voucher.pdf renders the generic ใบสำคัญจ่าย (no line table) for a PAYROLL document — the per-employee slip is a browser document (PaymentVoucherPage); unchanged here' }));
  });

  describe('browser — the real admin web app through the Vite proxy', () => {
    let context: BrowserContext | null = null;
    let accountantSession: { context: BrowserContext; page: Page; errors: string[]; runtime: WebRuntime } | null = null;
    afterEach(async () => { await context?.close().catch(() => undefined); context = null; });
    afterAll(async () => { await accountantSession?.context.close().catch(() => undefined); });

    it('/expenses/:id/voucher prints one A4 slip per employee with earnings, exempt badge, deductions, net and two signature slots — nothing from another employee on the page', async () => {
      const doc = docs.p1!;
      accountantSession = await openAs(world.users.accountant, `/expenses/${doc.id}/voucher`);
      const { page, errors } = accountantSession;
      await waitForText(page, 'PAYROLL · 1/3', 'payroll-slips');
      await page.waitForFunction(() => document.querySelectorAll('article.voucher-sheet').length === 3, undefined, { timeout: 30_000 });
      expect(await page.title()).toBe(`ใบจ่ายเงินเดือน ${doc.number}`);
      const slips = await page.locator('article.voucher-sheet').allInnerTexts();
      const names = ['ทดสอบระบบ พนักงาน e1', 'ทดสอบระบบ พนักงาน e2', E3_NAME()];
      const money1 = payrollLineMoney(p1Lines()[0]), money2 = payrollLineMoney(p1Lines()[1]), money3 = payrollLineMoney(p1Lines()[2]);
      const common = ['ใบจ่ายเงินเดือน', doc.number, `งวด\t${P1.period}`.replace('\t', '\n').split('\n')[0], thaiLongDate(P1.date), SHOP_BANK, 'เงินเดือนพื้นฐาน', 'รวมรายได้', 'รวมรายการหัก', 'สุทธิที่จ่าย', '(ผู้รับเงิน)', '(ผู้จัดทำ)'];
      slips.forEach((slip, index) => {
        expect(slip).toContain(`PAYROLL · ${index + 1}/3`);
        expect(slip).toContain(names[index]);
        for (const other of names.filter((_, i) => i !== index)) expect(slip).not.toContain(other);
        for (const token of common) expect(slip).toContain(token);
        expect(slip).toContain(`ใบจ่ายเงินเดือน v1.0 · ${index + 1}/3`);
      });
      expect(slips[0]).toContain(e1.nationalId);
      expect(slips[0]).toContain('S52-1202');
      expect(slips[0]).toContain('ค่าล่วงเวลา');
      expect(slips[0]).not.toContain('ม.42 ยกเว้นภาษี');
      expect(slips[0]).toContain('หัก ณ ที่จ่าย (ภ.ง.ด. 1)');
      for (const amount of ['18,000.00', '1,000.00', '19,000.00', '875.00', '150.00', '1,025.00', '17,975.00']) expect(slips[0]).toContain(amount);
      expect(slips[0]).toContain('หนึ่งหมื่นเจ็ดพันเก้าร้อยเจ็ดสิบห้าบาทถ้วน');
      expect(slips[1]).toContain(e2.taxId);
      expect(slips[1]).toContain('S52-1204');
      expect(slips[1]).toContain('เบี้ยเลี้ยงเดินทาง');
      expect(slips[1]).toContain('ม.42 ยกเว้นภาษี');
      expect(slips[1]).toContain('S21-1103');
      expect(slips[1]).toContain('คืนเงินยืม');
      expect(slips[1]).not.toContain('หัก ณ ที่จ่าย (ภ.ง.ด. 1)');
      for (const amount of ['12,000.00', '500.00', '12,500.00', '600.00', '1,100.00', '11,400.00']) expect(slips[1]).toContain(amount);
      expect(slips[1]).toContain('หนึ่งหมื่นหนึ่งพันสี่ร้อยบาทถ้วน');
      expect(slips[2]).toContain('9,000.00');
      expect(slips[2]).toContain('450.00');
      expect(slips[2]).toContain('8,550.00');
      expect(slips[2]).toContain('แปดพันห้าร้อยห้าสิบบาทถ้วน');
      expect(slips[2]).toMatch(/เลขประจำตัวผู้เสียภาษี\s*\n?\s*—/);
      const screenshots = await shots(page, 'payroll-slips');
      const printed = await printToPdf(page, 'payroll-slips-print');
      const pdf = printed.pdf;
      expect(pdf.pageCount).toBe(3);
      expect(pdf.pages.every(isA4)).toBe(true);
      expect(pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
      expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
      names.forEach((name, index) => {
        expect(pageStream(pdf, index + 1)).toContain(foldThai(name));
        for (const other of names.filter((_, i) => i !== index)) expect(pageStream(pdf, index + 1)).not.toContain(foldThai(other));
        expect(pageStream(pdf, index + 1)).toContain(foldThai(`PAYROLL · ${index + 1}/3`));
        expect(pageStream(pdf, index + 1)).toContain(foldThai('(ผู้รับเงิน)'));
        expect(pageStream(pdf, index + 1)).toContain(foldThai('(ผู้จัดทำ)'));
      });
      expect(pageStream(pdf, 1)).toContain(foldThai(money(money1.net)));
      expect(pageStream(pdf, 2)).toContain(foldThai(money(money2.net)));
      expect(pageStream(pdf, 3)).toContain(foldThai(money(money3.net)));
      expect(streamText(pdf)).not.toContain(foldThai('พิมพ์ / Save PDF'));
      expect(pageErrors(errors)).toEqual([]);
      const artifacts = [...screenshots, printed.printMediaShot, printed.artifact, saveArtifact(DOMAIN, 'payroll-slips-print.pdf.json', JSON.stringify({ ...pdfSummary(pdf), fontLoaded: printed.fontLoaded, consoleErrors: errors }, null, 2)).relativePath];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-payroll-slips`, title: 'PaymentVoucherPage for a PAYROLL document: three slips (1/3..3/3), each with only its employee, base + custom income (ม.42 badge on exempt), SSO/WHT/deduction, net in words, ผู้รับเงิน/ผู้จัดทำ; print-media PDF = 3 A4 portrait pages in TH Sarabun PSK 16 pt, one employee per page', routes: ['POST /api/auth/login', 'GET /api/expense-documents/:id', 'GET /api/companies/public'], artifacts, notes: consoleNote(errors) }));
    }, 300000);

    it('/finance/wht-annual lists the year, prints the ม.50 ทวิ certificate for the chosen employee only with the FINANCE issuer, and changes cleanly between recipients and years', async () => {
      expect(accountantSession).not.toBeNull();
      const { page, errors, runtime } = accountantSession!;
      errors.length = 0;
      await runtime.navigate(page, '/finance/wht-annual');
      // The slips of the previous route stay on screen until the new page renders — anchor on this page's own header + table first.
      await waitForText(page, 'ภ.ง.ด.1ก + ใบ 50 ทวิ — สรุปรายปี', 'wht-annual-header');
      const annualTable = page.locator('table').filter({ hasText: 'เดือนที่จ่าย' }).first();
      await annualTable.waitFor({ state: 'visible', timeout: 60_000 });
      await waitForText(page, 'รวม 4 คน', 'wht-annual-table');
      const table = await annualTable.innerText();
      for (const name of ['ทดสอบระบบ พนักงาน e1', 'ทดสอบระบบ พนักงาน e2', E3_NAME(), 'ทดสอบระบบ พนักงาน e4']) expect(table).toContain(name);
      expect(table).toContain(e1.nationalId);
      expect(table).toContain(e2.taxId);
      for (const amount of ['37,000.00', '350.00', '1,750.00', '24,000.00', '28,000.00', '107,000.00', '850.00']) expect(table).toContain(amount);
      expect(table).toContain('รวม 4 คน');
      const screenshots = await shots(page, 'wht-annual-page');
      // The table page itself prints landscape (document-landscape).
      const tablePrint = await printToPdf(page, 'wht-annual-table-print');
      expect(tablePrint.pdf.pages.every(isA4Landscape)).toBe(true);
      expect(tablePrint.pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
      for (const name of ['ทดสอบระบบ พนักงาน e1', 'ทดสอบระบบ พนักงาน e4', E3_NAME()]) expect(streamText(tablePrint.pdf)).toContain(foldThai(name));
      expect(streamText(tablePrint.pdf)).toContain(foldThai('107,000.00'));

      // Certificate for e1.
      const rowOf = (name: string) => annualTable.locator('tr').filter({ hasText: name }).first();
      const dialog = page.getByRole('dialog');
      const openCertificate = async (name: string, label: string) => {
        await rowOf(name).getByRole('button', { name: /50 ทวิ/ }).click();
        await dialog.waitFor({ state: 'visible', timeout: 30_000 });
        try {
          await dialog.getByText('หนังสือรับรองการหักภาษี ณ ที่จ่าย').first().waitFor({ timeout: 30_000 });
        } catch (error) {
          saveArtifact(DOMAIN, `failure-${label}.png`, await page.screenshot({ fullPage: true }).catch(() => Buffer.alloc(0)));
          saveArtifact(DOMAIN, `failure-${label}.txt`, `${page.url()}\n\n[dialog]\n${await dialog.innerText().catch(() => '')}\n\n[body]\n${(await page.locator('body').innerText().catch(() => '')).slice(0, 4000)}`);
          throw new Error(`${label}: certificate did not render — ${String((error as Error).message).split('\n')[0]}`);
        }
        return dialog.innerText();
      };
      const cert1 = await openCertificate('ทดสอบระบบ พนักงาน e1', 'wht-certificate-e1');
      for (const token of ['หนังสือรับรองการหักภาษี ณ ที่จ่าย', 'ตามมาตรา 50 ทวิ', `ปีภาษี ${YEAR + 543}`, 'ทดสอบระบบ บริษัทไฟแนนซ์', 'เลขประจำตัวผู้เสียภาษี 0000000000000', 'ข้อมูลทดสอบระบบ — ลบได้', 'ทดสอบระบบ พนักงาน e1', e1.nationalId, '37,000.00', '350.00', '1,750.00', 'ลงชื่อ ผู้จ่ายเงิน (ทดสอบระบบ ผู้ลงนาม)']) expect(cert1).toContain(token);
      expect(cert1).not.toContain('ทดสอบระบบ บริษัทหน้าร้าน');
      for (const other of ['ทดสอบระบบ พนักงาน e2', 'ทดสอบระบบ พนักงาน e4', E3_NAME(), '24,000.00', '28,000.00']) expect(cert1).not.toContain(other);
      const certShot = saveArtifact(DOMAIN, 'wht-certificate-e1-1440.png', await page.screenshot({ fullPage: true })).relativePath;
      const certPrint = await printToPdf(page, 'wht-certificate-e1-print');
      expect(certPrint.pdf.pageCount).toBe(1);
      expect(certPrint.pdf.pages.every(isA4)).toBe(true);
      expect(certPrint.pdf.fonts.filter((font) => !font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toEqual([]);
      expect(textSizes(certPrint.pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
      expect(pageContaining(certPrint.pdf, 'หนังสือรับรองการหักภาษี ณ ที่จ่าย')).toBe(1);
      const certStream = streamText(certPrint.pdf);
      for (const token of ['ทดสอบระบบ บริษัทไฟแนนซ์', '0000000000000', 'ทดสอบระบบ พนักงาน e1', e1.nationalId, '37,000.00', '350.00', 'ลงชื่อ ผู้จ่ายเงิน']) expect(certStream).toContain(foldThai(token));
      for (const other of ['ทดสอบระบบ พนักงาน e2', 'ทดสอบระบบ พนักงาน e4', 'ภ.ง.ด.1ก + ใบ 50 ทวิ — สรุปรายปี', 'ดาวน์โหลด Excel']) expect(certStream).not.toContain(foldThai(other));
      expect(pageContaining(certPrint.pdf, 'ลงชื่อ ผู้จ่ายเงิน')).toBe(pageContaining(certPrint.pdf, 'ภาษีที่หักนำส่ง'));
      await dialog.getByRole('button', { name: 'ปิด' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });

      // Certificate for e2 (tax id from the profile override) and for the free-text employee (no tax id → dotted line).
      const cert2 = await openCertificate('ทดสอบระบบ พนักงาน e2', 'wht-certificate-e2');
      for (const token of ['ทดสอบระบบ พนักงาน e2', e2.taxId, '24,000.00', '0.00', '1,200.00']) expect(cert2).toContain(token);
      for (const other of ['ทดสอบระบบ พนักงาน e1', e1.nationalId, '37,000.00', '350.00']) expect(cert2).not.toContain(other);
      const cert2Print = await printToPdf(page, 'wht-certificate-e2-print');
      expect(streamText(cert2Print.pdf)).toContain(foldThai(e2.taxId));
      expect(streamText(cert2Print.pdf)).not.toContain(foldThai('ทดสอบระบบ พนักงาน e1'));
      await dialog.getByRole('button', { name: 'ปิด' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      const cert3 = await openCertificate(E3_NAME(), 'wht-certificate-e3');
      expect(cert3).toContain(E3_NAME());
      expect(cert3).toContain('เลขประจำตัวผู้เสียภาษี ................................');
      expect(cert3).toContain('18,000.00');
      await dialog.getByRole('button', { name: 'ปิด' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });

      // Another tax year: the table empties and no certificate is offered.
      // A combobox takes no accessible name from its content (ARIA), so match the Radix trigger by its visible text.
      await page.getByRole('combobox').filter({ hasText: 'ปีภาษี' }).first().click();
      await page.getByRole('option', { name: `ปีภาษี ${YEAR - 1 + 543}` }).click();
      await waitForText(page, `ไม่มีใบเงินเดือนที่ POST แล้วในปี ${YEAR - 1 + 543}`, 'wht-annual-previous-year');
      expect(await page.getByRole('button', { name: /50 ทวิ/ }).count()).toBe(0);
      const emptyShot = saveArtifact(DOMAIN, 'wht-annual-previous-year-1440.png', await page.screenshot({ fullPage: true })).relativePath;

      // Regression (defect fixed in DOC-04): the page called GET /company — a route that does not exist (404) — and
      // then fell back to the first company row, so with FINANCE missing the SHOP identity would have been printed
      // as the payer. Hide the FINANCE entity for one reload: the dialog must say so plainly and offer nothing to print.
      const financeRow = await h.prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null } });
      await h.prisma.companyInfo.update({ where: { id: financeRow.id }, data: { companyCode: 'FINANCE_HIDDEN_BY_TEST' } });
      let noFinanceShot: string;
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForText(page, 'รวม 4 คน', 'wht-annual-no-finance-table');
        await rowOf('ทดสอบระบบ พนักงาน e1').getByRole('button', { name: /50 ทวิ/ }).click();
        await dialog.waitFor({ state: 'visible', timeout: 30_000 });
        await dialog.getByText('ไม่พบข้อมูลบริษัทฝั่ง FINANCE').waitFor({ timeout: 30_000 });
        const noFinance = await dialog.innerText();
        expect(noFinance).not.toContain('ทดสอบระบบ บริษัทหน้าร้าน');
        expect(noFinance).not.toContain('หนังสือรับรองการหักภาษี ณ ที่จ่าย');
        expect(noFinance).not.toContain('ทดสอบระบบ พนักงาน e1');
        expect(await dialog.getByRole('button', { name: 'พิมพ์' }).count()).toBe(0);
        noFinanceShot = saveArtifact(DOMAIN, 'wht-certificate-no-finance-1440.png', await page.screenshot({ fullPage: true })).relativePath;
        await dialog.getByRole('button', { name: 'ปิด' }).click();
        await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      } finally {
        await h.prisma.companyInfo.update({ where: { id: financeRow.id }, data: { companyCode: 'FINANCE' } });
      }
      expect(pageErrors(errors)).toEqual([]);
      const artifacts = [...screenshots, tablePrint.artifact, certShot, certPrint.printMediaShot, certPrint.artifact, cert2Print.artifact, emptyShot, noFinanceShot, saveArtifact(DOMAIN, 'wht-certificate-e1-print.pdf.json', JSON.stringify({ ...pdfSummary(certPrint.pdf), table: pdfSummary(tablePrint.pdf), consoleErrors: errors }, null, 2)).relativePath];
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-wht-annual`, title: 'WhtAnnualPage: annual table (landscape print) with all four employees and totals; 50 ทวิ dialog prints one portrait A4 page for the chosen employee only, issuer = FINANCE CompanyInfo (name/tax id/address/director) never the SHOP entity; recipients switch without carry-over; previous year empty; FINANCE entity missing → plain message, nothing printable (defect: page called a non-existent /company route and fell back to the first company)', documents: ['PND1A', 'WHT_CERTIFICATE_50BIS'], routes: ['GET /api/tax/pnd1-annual-preview', 'GET /api/companies'], artifacts, notes: consoleNote(errors) }));
    }, 300000);

    it('a branch manager sees masked tax ids on the slips and cannot open the annual page', async () => {
      const doc = docs.p1!;
      const opened = await openAs(world.users.branchManagerA, `/expenses/${doc.id}/voucher`);
      context = opened.context;
      const { page, errors, runtime } = opened;
      await waitForText(page, 'PAYROLL · 1/3', 'payroll-slips-manager');
      const slips = await page.locator('article.voucher-sheet').allInnerTexts();
      expect(slips[0]).toContain(`•••••••••${e1.nationalId.slice(-4)}`);
      expect(slips[0]).not.toContain(e1.nationalId);
      expect(slips[1]).toContain(`•••••••••${e2.taxId.slice(-4)}`);
      const maskedShot = saveArtifact(DOMAIN, 'payroll-slips-manager-masked-1440.png', await page.screenshot({ fullPage: true })).relativePath;
      await runtime.navigate(page, '/finance/wht-annual');
      await page.waitForTimeout(2000);
      expect(await page.getByText('ภ.ง.ด.1ก + ใบ 50 ทวิ — สรุปรายปี').count()).toBe(0);
      expect(await page.getByRole('button', { name: /50 ทวิ/ }).count()).toBe(0);
      const deniedShot = saveArtifact(DOMAIN, 'wht-annual-manager-denied-1440.png', await page.screenshot({ fullPage: true })).relativePath;
      expect(pageErrors(errors)).toEqual([]);
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/browser-manager-pii`, title: 'BRANCH_MANAGER of the payroll branch: slips render with masked tax ids (•••••••••dddd) — the API masks by role; /finance/wht-annual is not reachable (route role gate), no certificate button anywhere', routes: ['POST /api/auth/login', 'GET /api/expense-documents/:id'], renderer: 'none', artifacts: [maskedShot, deniedShot], notes: `${consoleNote(errors)}; landed on ${page.url()}` }));
    }, 300000);
  });

  it('never called an outbound transport during the whole flow', () => {
    expect(h.external.calls).toEqual([]);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: 'LINE/SMS/e-mail recorder stayed empty for the entire scenario file', routes: [], renderer: 'none', artifacts: [] }));
  });
});
