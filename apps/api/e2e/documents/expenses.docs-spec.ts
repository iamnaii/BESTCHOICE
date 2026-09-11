import { randomUUID } from 'crypto';
import request from 'supertest';
import { DOCUMENT_STYLE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { bangkokDate, createWorldUser, expectedExpenseTotals, expectedPettyCashTotals, ExpenseLineSpec, grantAccountingPermissions, journalBalances, setSystemConfig } from './support/expense-fixtures';
import { recordScenario, saveArtifact, ScenarioRecord } from './support/artifacts';
import { contentSignature, foldThai, isA4, pageContaining, pageText, parsePdf, ParsedPdf, textSizes } from './support/pdf';

/**
 * DOC-03 (issue #1562): expense/payment vouchers, petty cash reimbursement,
 * void reversal and the daily expense summary, driven through the real
 * expense-documents API (create → post / submit → approve → auto-post → void),
 * the real journal templates and the real Chromium voucher renderer.
 */
const DOMAIN = 'expenses';
const GUARDS = ['CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard', 'BranchGuard', 'accounting_permissions (assertAccountingPermission / assertAccountingBranch)', 'findOne branch scope on GET /:id and GET /:id/voucher.pdf', 'EntityScopeInterceptor', 'AuditInterceptor'];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded, never sent',
  'private local directory instead of GCS/S3',
  'company, branches, users are synthetic Prisma rows with test markers; documents themselves are created through the API',
  'SystemConfig approval_enabled / approval_threshold / accounting_permissions set directly (the same rows the settings UI writes)',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['PAYMENT_VOUCHER'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

type ExpenseDoc = { id: string; number: string; status: string; documentType: string; subtotal: string; vatAmount: string; withholdingTax: string; totalAmount: string; netPayment: string | null; journalEntryId: string | null; branchId: string; approvedById?: string | null };
const money = (value: string | number | { toString(): string } | null | undefined) => Number(Number((value ?? 0).toString()).toFixed(2));
const fmt = (value: string | number) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe('DOC-03 expense vouchers, petty cash and daily summary — real lifecycle, journal and renderer', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let owner: Session, accountant: Session, branchManagerA: Session, branchManagerB: Session, salesA: Session;
  const docs: Partial<Record<'vatWht' | 'approved' | 'petty' | 'long' | 'draft' | 'branchB' | 'yesterday' | 'lateNight' | 'nextDay', ExpenseDoc>> = {};
  const today = bangkokDate(0);
  const pdfs = new Map<string, Buffer>();

  // BRANCH_MANAGER accounts hold SHOP only (their expense menu lives in the SHOP zone); accounting roles work in FINANCE.
  const c = (session: Session | null) => h.client({ session, company: session && !session.user.accessibleCompanies.includes('FINANCE') ? 'SHOP' : 'FINANCE' });
  const ok = async (test: request.Test, status = 201, label = 'request'): Promise<request.Response> => {
    const response = await test;
    if (response.status !== status) throw new Error(`${label} → ${response.status} (expected ${status}) ${JSON.stringify(response.body)}`);
    return response;
  };
  const load = async (id: string): Promise<ExpenseDoc> => {
    const row = await h.prisma.expenseDocument.findUniqueOrThrow({ where: { id } });
    return { id: row.id, number: row.number, status: row.status, documentType: row.documentType, subtotal: row.subtotal.toString(), vatAmount: row.vatAmount.toString(), withholdingTax: row.withholdingTax.toString(), totalAmount: row.totalAmount.toString(), netPayment: row.netPayment?.toString() ?? null, journalEntryId: row.journalEntryId, branchId: row.branchId, approvedById: row.approvedById };
  };
  const createExpense = async (session: Session, body: Record<string, unknown>) => {
    const response = await ok(c(session).post('/expense-documents', { documentType: 'EXPENSE', branchId: world.branches.a.id, documentDate: today, priceType: 'EXCLUSIVE', paymentMethod: 'CASH', depositAccountCode: '11-1101', ...body }), 201, 'POST /expense-documents');
    return load((response.body.data as { id: string }).id);
  };
  const post = async (session: Session, id: string) => { await ok(c(session).post(`/expense-documents/${id}/post`), 201, `POST /expense-documents/${id}/post`); return load(id); };
  const voucherPdf = async (session: Session | null, id: string): Promise<Buffer> => {
    const response = await c(session).get(`/expense-documents/${id}/voucher.pdf`).expect(200).expect('Content-Type', /application\/pdf/);
    expect(response.headers['content-disposition']).toContain(`expense-voucher-${id}.pdf`);
    const bytes = bodyBuffer(response);
    pdfs.set(id, bytes);
    return bytes;
  };
  const has = (pdf: ParsedPdf, needle: string) => foldThai(pdf.pages.map(pageText).join('\n')).includes(foldThai(needle));
  const expectAll = (pdf: ParsedPdf, needles: string[]) => { for (const needle of needles) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: true }); };
  const expectNone = (pdf: ParsedPdf, needles: string[]) => { for (const needle of needles) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: false }); };
  const expectBaseline = (pdf: ParsedPdf, label: string, pages = 1) => {
    expect({ label, pages: pdf.pageCount }).toEqual({ label, pages });
    expect(pdf.pages.every(isA4)).toBe(true);
    expect(pdf.fonts.length).toBeGreaterThan(0);
    expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
    expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
  };
  const savePdf = async (name: string, doc: ExpenseDoc, bytes: Buffer, extra: Record<string, unknown> = {}) => {
    const pdf = await parsePdf(bytes);
    const a = saveArtifact(DOMAIN, `${name}.pdf`, bytes);
    const b = saveArtifact(DOMAIN, `${name}.pdf.json`, JSON.stringify({ document: doc, ...extra, pageCount: pdf.pageCount, fonts: pdf.fonts, sizes: textSizes(pdf).slice(0, 6), lines: pdf.pages.flatMap((page) => page.lines) }, null, 2));
    return { pdf, artifacts: [a.relativePath, b.relativePath] };
  };
  const vatWhtLines: ExpenseLineSpec[] = [
    { category: '53-1201', description: 'กระดาษ A4 ทดสอบระบบ', quantity: 10, unitPrice: 120, vatPercent: 7, whtPercent: 3 },
    { category: '53-1302', description: 'ค่าไฟฟ้าสำนักงาน ทดสอบระบบ', quantity: 1, unitPrice: 2500, vatPercent: 7, whtPercent: 1 },
  ];
  const vatWhtExpected = expectedExpenseTotals(vatWhtLines);

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    const managerB = await createWorldUser(h.prisma, { prefix: world.prefix, key: 'manager-b', role: 'BRANCH_MANAGER', branchId: world.branches.b.id, password: world.password });
    [owner, accountant, branchManagerA, branchManagerB, salesA] = await Promise.all(
      [world.users.owner, world.users.accountant, world.users.branchManagerA, managerB, world.users.salesA].map((u) => h.login(u.email, u.password)),
    );
    await grantAccountingPermissions(h.prisma, accountant.user.id, ['EXPENSE_POST', 'EXPENSE_APPROVE', 'EXPENSE_CANCEL']);
    await grantAccountingPermissions(h.prisma, branchManagerA.user.id, ['EXPENSE_POST']);
    await grantAccountingPermissions(h.prisma, branchManagerB.user.id, ['EXPENSE_POST']);
    await setSystemConfig(h.prisma, 'approval_enabled', 'false');
  }, 180000);

  afterAll(async () => { await h?.close(); });

  it('expense with VAT 7% + WHT (ภ.ง.ด.53) → DRAFT cannot print, POSTED voucher and journal match the independent totals', async () => {
    const doc = await createExpense(owner, { vendorName: 'ทดสอบระบบ ผู้ขาย จำกัด', vendorTaxId: '0000000000000', taxInvoiceNo: `${world.prefix}-TI-1`, whtFormType: 'PND53', description: 'ซื้อวัสดุสำนักงานและค่าไฟ', lines: vatWhtLines });
    expect(doc.status).toBe('DRAFT');
    expect(doc.number).toMatch(/^EX-\d{4}-\d{3,}$/);
    expect({ subtotal: money(doc.subtotal), vat: money(doc.vatAmount), total: money(doc.totalAmount), wht: money(doc.withholdingTax), net: money(doc.netPayment) })
      .toEqual({ subtotal: money(vatWhtExpected.subtotal), vat: money(vatWhtExpected.vat), total: money(vatWhtExpected.total), wht: money(vatWhtExpected.wht), net: money(vatWhtExpected.net) });
    const draftPdf = await c(owner).get(`/expense-documents/${doc.id}/voucher.pdf`).expect(400);
    expect(draftPdf.body.message).toContain('ยังไม่ได้บันทึกจ่าย');
    const posted = await post(owner, doc.id);
    expect(posted.status).toBe('POSTED');
    expect(posted.journalEntryId).toBeTruthy();
    const journal = await journalBalances(h.prisma, posted.journalEntryId!);
    expect(journal['53-1201']?.debit).toBe(vatWhtExpected.lines[0].amountBeforeVat);
    expect(journal['53-1302']?.debit).toBe(vatWhtExpected.lines[1].amountBeforeVat);
    expect(journal['11-4101']?.debit).toBe(vatWhtExpected.vat);
    expect(journal['21-3103']?.credit).toBe(vatWhtExpected.wht);
    expect(journal['11-1101']?.credit).toBe(vatWhtExpected.net);
    const debits = Object.values(journal).reduce((sum, v) => sum + Number(v.debit), 0);
    const credits = Object.values(journal).reduce((sum, v) => sum + Number(v.credit), 0);
    expect(debits.toFixed(2)).toBe(credits.toFixed(2));
    const bytes = await voucherPdf(owner, doc.id);
    const { pdf, artifacts } = await savePdf('voucher-vat-wht', posted, bytes, { expected: vatWhtExpected, journal });
    expectBaseline(pdf, 'voucher-vat-wht');
    expectAll(pdf, ['ใบสำคัญจ่าย', 'PAYMENT VOUCHER', posted.number, 'ทดสอบระบบ ผู้ขาย จำกัด', '0000000000000', `${world.prefix}-TI-1`, 'กระดาษ A4 ทดสอบระบบ', 'ค่าไฟฟ้าสำนักงาน ทดสอบระบบ', '53-1201', '53-1302',
      'มูลค่าก่อนภาษี', fmt(vatWhtExpected.subtotal), 'ภาษีมูลค่าเพิ่ม 7%', fmt(vatWhtExpected.vat), 'มูลค่ารวม', fmt(vatWhtExpected.total), 'หัก ณ ที่จ่าย', fmt(vatWhtExpected.wht), 'จำนวนเงินจ่ายสุทธิ', `${fmt(vatWhtExpected.net)} บาท`,
      'ผู้จัดทำ', 'OWNER', 'ผู้อนุมัติ', 'ผู้รับเงิน', 'สาขา A']);
    expectNone(pdf, ['ยกเลิก / กลับรายการแล้ว']);
    docs.vatWht = posted;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/voucher-vat-wht`, title: 'EXPENSE (2 lines, VAT 7%, WHT 3%/1% PND53) DRAFT→POSTED: totals = independent CPA rule, journal Dr 5x/11-4101 Cr 11-1101/21-3103, voucher PDF prints every amount and the 3 signature boxes', routes: ['POST /api/expense-documents', 'POST /api/expense-documents/:id/post', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts }));
  });

  it('approval workflow: ACCOUNTANT drafts and submits, cannot approve own document, OWNER approves → auto-posted voucher shows the approver', async () => {
    await setSystemConfig(h.prisma, 'approval_enabled', 'true');
    await setSystemConfig(h.prisma, 'approval_threshold', '1000');
    try {
      const lines: ExpenseLineSpec[] = [{ category: '53-1105', description: 'ค่าอบรม ทดสอบระบบ', quantity: 1, unitPrice: 2000, vatPercent: 7 }];
      const expected = expectedExpenseTotals(lines);
      const doc = await createExpense(accountant, { vendorName: 'ทดสอบระบบ สถาบันอบรม', lines });
      const blocked = await c(accountant).post(`/expense-documents/${doc.id}/post`).expect(400);
      expect(blocked.body.message).toContain('อนุมัติ');
      await ok(c(accountant).post(`/expense-documents/${doc.id}/submit-for-approval`), 201, 'submit-for-approval');
      expect((await load(doc.id)).status).toBe('PENDING_APPROVAL');
      await c(accountant).post(`/expense-documents/${doc.id}/approve`).expect(403);
      await c(salesA).post(`/expense-documents/${doc.id}/approve`).expect(403);
      await ok(c(owner).post(`/expense-documents/${doc.id}/approve`), 201, 'approve');
      const approved = await load(doc.id);
      expect(approved.status).toBe('POSTED');
      expect(approved.approvedById).toBe(owner.user.id);
      expect(money(approved.totalAmount)).toBe(money(expected.total));
      const bytes = await voucherPdf(accountant, doc.id);
      const { pdf, artifacts } = await savePdf('voucher-approved', approved, bytes, { expected });
      expectBaseline(pdf, 'voucher-approved');
      expectAll(pdf, ['ผู้จัดทำ', 'ACCOUNTANT', 'ผู้อนุมัติ', 'OWNER', fmt(expected.total)]);
      docs.approved = approved;
      recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/approval-maker-checker`, title: 'approval_enabled + threshold: post blocked (400), submit → PENDING_APPROVAL, self-approve 403, SALES 403, OWNER approve → auto POSTED; voucher prints preparer + approver', routes: ['POST /api/expense-documents', 'POST /api/expense-documents/:id/post', 'POST /api/expense-documents/:id/submit-for-approval', 'POST /api/expense-documents/:id/approve', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts }));
    } finally {
      await setSystemConfig(h.prisma, 'approval_enabled', 'false');
    }
  });

  it('petty cash reimbursement (3 suppliers) → voucher without WHT row or signature grid, journal Cr 11-1103', async () => {
    const lines = [
      { supplierName: 'ทดสอบระบบ ร้านเครื่องเขียน', category: '53-1201', description: 'ปากกาและแฟ้ม', amount: 350 },
      { supplierName: 'ทดสอบระบบ ร้านอาหาร', category: '53-1106', description: 'อาหารกลางวันประชุม', amount: 420 },
      { supplierName: 'ทดสอบระบบ ร้านโทรคมนาคม', category: '53-1303', description: 'ค่าโทรศัพท์', amount: 180, vatPercent: 7 },
    ];
    const expected = expectedPettyCashTotals(lines);
    const created = await ok(c(branchManagerA).post('/expense-documents/petty-cash', { branchId: world.branches.a.id, documentDate: today, depositAccountCode: '11-1103', custodianName: 'ทดสอบระบบ ผู้ดูแลเงินสดย่อย', description: 'เบิกชดเชยเงินสดย่อยประจำสัปดาห์', lines }), 201, 'POST /expense-documents/petty-cash');
    const doc = await post(branchManagerA, (created.body.data as { id: string }).id);
    expect(doc.documentType).toBe('PETTY_CASH_REIMBURSEMENT');
    expect(doc.number).toMatch(/^PC-/);
    expect(money(doc.totalAmount)).toBe(money(expected.total));
    expect(money(doc.withholdingTax)).toBe(0);
    const journal = await journalBalances(h.prisma, doc.journalEntryId!);
    expect(journal['53-1201']?.debit).toBe('350.00');
    expect(journal['53-1106']?.debit).toBe('420.00');
    expect(journal['53-1303']?.debit).toBe('180.00');
    expect(journal['11-4101']?.debit).toBe(expected.vat);
    expect(journal['11-1103']?.credit).toBe(expected.total);
    const bytes = await voucherPdf(branchManagerA, doc.id);
    const { pdf, artifacts } = await savePdf('voucher-petty-cash', doc, bytes, { expected, journal });
    expectBaseline(pdf, 'voucher-petty-cash');
    expectAll(pdf, ['ใบเบิกชดเชยเงินสดย่อย', 'PETTY CASH REIMBURSEMENT', doc.number, 'ผู้ดูแลเงินสดย่อย', 'ทดสอบระบบ ผู้ดูแลเงินสดย่อย', 'บัญชีเงินสดย่อย', '11-1103', 'ทดสอบระบบ ร้านเครื่องเขียน', 'ทดสอบระบบ ร้านอาหาร', 'ทดสอบระบบ ร้านโทรคมนาคม', 'มูลค่าก่อนภาษี', fmt(expected.subtotal), fmt(expected.vat), 'จำนวนเงินจ่ายสุทธิ', `${fmt(expected.total)} บาท`, 'สแกนเพื่อตรวจสอบ']);
    expectNone(pdf, ['หัก ณ ที่จ่าย', 'ผู้อนุมัติ', 'ผู้รับเงิน', 'PAYMENT VOUCHER']);
    docs.petty = doc;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/petty-cash`, title: 'PETTY_CASH_REIMBURSEMENT with 3 suppliers: V20 float account 11-1103, no WHT, voucher titled ใบเบิกชดเชยเงินสดย่อย without signature grid (server renderer aligned with the print-page policy)', documents: ['PETTY_CASH_VOUCHER'], routes: ['POST /api/expense-documents/petty-cash', 'POST /api/expense-documents/:id/post', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts, notes: 'Defect fixed in this issue: ExpenseVoucherPdfService printed ผู้จัดทำ/ผู้อนุมัติ/ผู้รับเงิน boxes for petty cash although the policy (web PettyCashSheet) has no signature grid' }));
  });

  it('void → reversal journal and the voucher carries the ยกเลิก overlay; a DRAFT still cannot print', async () => {
    const doc = docs.vatWht!;
    const journalCountBefore = await h.prisma.journalEntry.count();
    await c(salesA).post(`/expense-documents/${doc.id}/void`, { reasonCode: 'wrong_amount' }).expect(403);
    // reverse_reason_required defaults to true and the code must come from the configured reverse_reasons list.
    const noReason = await c(owner).post(`/expense-documents/${doc.id}/void`, {}).expect(400);
    expect(noReason.body.message).toContain('เหตุผล');
    await c(owner).post(`/expense-documents/${doc.id}/void`, { reasonCode: 'ทดสอบระบบ-ไม่มีในรายการ' }).expect(400);
    await ok(c(owner).post(`/expense-documents/${doc.id}/void`, { reasonCode: 'wrong_amount' }), 201, 'void');
    const voided = await load(doc.id);
    expect(voided.status).toBe('VOIDED');
    expect(await h.prisma.journalEntry.count()).toBe(journalCountBefore + 1);
    const bytes = await voucherPdf(owner, doc.id);
    const { pdf, artifacts } = await savePdf('voucher-voided', voided, bytes);
    expectBaseline(pdf, 'voucher-voided');
    expectAll(pdf, ['ยกเลิก / กลับรายการแล้ว', voided.number, fmt(vatWhtExpected.net)]);
    const draft = await createExpense(owner, { vendorName: 'ทดสอบระบบ ร่างเอกสาร', lines: [{ category: '53-1201', description: 'ร่าง', quantity: 1, unitPrice: 500 }] });
    await c(owner).get(`/expense-documents/${draft.id}/voucher.pdf`).expect(400);
    docs.draft = draft;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/void-overlay`, title: 'void: SALES 403, missing/unknown reasonCode 400, OWNER with a configured reason → VOIDED + one reversal journal entry; voucher prints ยกเลิก / กลับรายการแล้ว; DRAFT voucher 400', routes: ['POST /api/expense-documents/:id/void', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts }));
  });

  it('a long voucher (28 lines) spans pages without losing rows; totals and signatures stay together on the last page', async () => {
    const lines: ExpenseLineSpec[] = Array.from({ length: 28 }, (_, i) => ({ category: i % 2 ? '53-1201' : '53-1202', description: `รายการยาว ทดสอบระบบ หมายเลข ${i + 1} — วัสดุสิ้นเปลืองสำนักงานสำหรับสาขา A ประจำเดือน`, quantity: i + 1, unitPrice: 12.5, vatPercent: 7 }));
    const expected = expectedExpenseTotals(lines);
    const doc = await post(owner, (await createExpense(owner, { vendorName: 'ทดสอบระบบ ร้านค้าส่ง จำกัด (สำนักงานใหญ่ ถนนนารายณ์มหาราช อำเภอเมืองลพบุรี)', lines })).id);
    expect(money(doc.totalAmount)).toBe(money(expected.total));
    const bytes = await voucherPdf(owner, doc.id);
    const pdf = await parsePdf(bytes);
    saveArtifact(DOMAIN, 'voucher-long-pages.json', JSON.stringify(pdf.pages.map((page) => ({ index: page.index, lines: page.lines })), null, 2));
    expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
    expect(pdf.pages.every(isA4)).toBe(true);
    expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
    for (let i = 1; i <= 28; i += 1) expect({ row: i, found: has(pdf, `หมายเลข ${i} —`) }).toEqual({ row: i, found: true });
    const totalsPage = pageContaining(pdf, 'จำนวนเงินจ่ายสุทธิ (ตัวอักษร)');
    expect(totalsPage).toBe(pdf.pageCount);
    // 'ผู้รับเงิน' also labels the payee block on page 1, so anchor the grid on 'ผู้อนุมัติ' + the QR caption.
    expect(pageContaining(pdf, 'ผู้อนุมัติ')).toBe(totalsPage);
    expect(pageContaining(pdf, 'สแกนเพื่อตรวจสอบ')).toBe(totalsPage);
    expect(pageContaining(pdf, 'รายการ / บัญชี')).toBe(1);
    const artifacts = (await savePdf('voucher-long', doc, bytes, { expected, totalsPage })).artifacts;
    docs.long = doc;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/long-voucher`, title: '28-line voucher: multi-page A4, every row present, closing totals + signature grid on the same (last) page', routes: ['POST /api/expense-documents', 'POST /api/expense-documents/:id/post', 'GET /api/expense-documents/:id/voucher.pdf'], artifacts }));
  });

  it('daily summary equals the documents of that Bangkok day and branch (status semantics: everything except VOIDED)', async () => {
    docs.branchB = await post(owner, (await createExpense(owner, { branchId: world.branches.b.id, vendorName: 'ทดสอบระบบ สาขา B', lines: [{ category: '53-1301', description: 'ค่าน้ำ สาขา B', quantity: 1, unitPrice: 700 }] })).id);
    docs.yesterday = await post(owner, (await createExpense(owner, { documentDate: bangkokDate(-1), vendorName: 'ทดสอบระบบ เมื่อวาน', lines: [{ category: '53-1301', description: 'ค่าน้ำ เมื่อวาน', quantity: 1, unitPrice: 600 }] })).id);
    docs.lateNight = await post(owner, (await createExpense(owner, { documentDate: `${today}T23:30:00+07:00`, vendorName: 'ทดสอบระบบ ดึก', lines: [{ category: '53-1203', description: 'อากรแสตมป์ 23:30', quantity: 1, unitPrice: 90 }] })).id);
    docs.nextDay = await post(owner, (await createExpense(owner, { documentDate: `${bangkokDate(1)}T00:10:00+07:00`, vendorName: 'ทดสอบระบบ พรุ่งนี้', lines: [{ category: '53-1203', description: 'อากรแสตมป์ 00:10 พรุ่งนี้', quantity: 1, unitPrice: 80 }] })).id);
    const included = [docs.approved!, docs.petty!, docs.long!, docs.draft!, docs.lateNight!];
    const excluded = [docs.vatWht!, docs.branchB!, docs.yesterday!, docs.nextDay!];
    const expectedTotal = included.reduce((sum, doc) => sum + money(doc.totalAmount), 0);
    const response = await c(owner).get('/expense-documents/daily-summary').query({ date: today, branchId: world.branches.a.id }).expect(200);
    const summary = response.body.data as { grandTotal: string; documents: Array<{ id: string; number: string }>; byType: Record<string, { count: number; total: string }>; byCategory: Record<string, { count: number; total: string }>; branchName: string };
    const listed = new Set(summary.documents.map((row) => row.id));
    for (const doc of included) expect({ number: doc.number, listed: listed.has(doc.id) }).toEqual({ number: doc.number, listed: true });
    for (const doc of excluded) expect({ number: doc.number, listed: listed.has(doc.id) }).toEqual({ number: doc.number, listed: false });
    expect(money(summary.grandTotal)).toBe(money(expectedTotal));
    expect(summary.byType.PETTY_CASH_REIMBURSEMENT.count).toBe(1);
    expect(summary.byType.EXPENSE.count).toBe(4);
    const categorySum = Object.values(summary.byCategory).reduce((sum, v) => sum + Number(v.total), 0);
    const expectedBeforeVat = included.reduce((sum, doc) => sum + money(doc.subtotal), 0);
    expect(categorySum.toFixed(2)).toBe(expectedBeforeVat.toFixed(2));
    expect(summary.branchName).toBe(world.branches.a.name);
    const pinned = await c(branchManagerA).get('/expense-documents/daily-summary').query({ date: today }).expect(200);
    expect(money(pinned.body.data.grandTotal)).toBe(money(expectedTotal));
    await c(branchManagerA).get('/expense-documents/daily-summary').query({ date: today, branchId: world.branches.b.id }).expect(403);
    await c(salesA).get('/expense-documents/daily-summary').query({ date: today, branchId: world.branches.a.id }).expect(403);
    const other = await c(accountant).get('/expense-documents/daily-summary').query({ date: today, branchId: world.branches.b.id }).expect(200);
    expect(other.body.data.documents.map((row: { id: string }) => row.id)).toEqual([docs.branchB!.id]);
    const artifact = saveArtifact(DOMAIN, 'daily-summary.json', JSON.stringify({ date: today, branch: world.branches.a.name, expectedTotal, summary }, null, 2));
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/daily-summary`, title: 'GET daily-summary: Bangkok-day window (23:30 in, next-day 00:10 out), branch A only, VOIDED excluded, DRAFT included (current semantics), totals = independent sums; BM pinned to own branch, foreign branchId 403, SALES 403', documents: ['EXPENSE_DAILY_SUMMARY'], routes: ['GET /api/expense-documents/daily-summary'], renderer: 'none', artifacts: [artifact.relativePath], notes: 'Observation: the summary counts DRAFT/PENDING/APPROVED/ACCRUAL documents alongside POSTED (only VOIDED is excluded) — confirm with the owner whether an unposted draft belongs on the printed daily sheet' }));
  });

  it('branch, role and unknown-id rules on the voucher route; denials carry JSON, never bytes', async () => {
    const doc = docs.approved!;
    for (const session of [branchManagerB, salesA]) {
      const response = await c(session).get(`/expense-documents/${doc.id}/voucher.pdf`).expect(403);
      expect(response.headers['content-type']).toMatch(/json/);
    }
    await c(branchManagerB).get(`/expense-documents/${doc.id}`).expect(403);
    await h.client({ session: null }).get(`/expense-documents/${doc.id}/voucher.pdf`).expect(401);
    await c(owner).get(`/expense-documents/${randomUUID()}/voucher.pdf`).expect(404);
    await voucherPdf(branchManagerA, doc.id);
    await voucherPdf(accountant, doc.id);
    await voucherPdf(branchManagerB, docs.branchB!.id);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/authorization`, title: 'BRANCH_MANAGER of another branch 403 on voucher.pdf and detail (defect found + fixed: voucher route had no branch scope), SALES 403, no token 401, unknown id 404', routes: ['GET /api/expense-documents/:id/voucher.pdf', 'GET /api/expense-documents/:id'], renderer: 'none', artifacts: [], notes: 'Before this change GET /expense-documents/:id/voucher.pdf rendered any document by id for every accounting role while GET /:id already enforced the branch' }));
  });

  it('printing repeatedly changes nothing in the books and renders the same content', async () => {
    const before = { journals: await h.prisma.journalEntry.count(), docs: (await h.prisma.expenseDocument.findMany({ select: { id: true, status: true, totalAmount: true } })).map((d) => `${d.id}:${d.status}:${d.totalAmount}`).sort() };
    for (const doc of [docs.approved!, docs.petty!, docs.long!]) {
      const first = contentSignature(await parsePdf(await voucherPdf(owner, doc.id)));
      const second = contentSignature(await parsePdf(await voucherPdf(owner, doc.id)));
      expect(first).toBe(second);
    }
    const after = { journals: await h.prisma.journalEntry.count(), docs: (await h.prisma.expenseDocument.findMany({ select: { id: true, status: true, totalAmount: true } })).map((d) => `${d.id}:${d.status}:${d.totalAmount}`).sort() };
    expect(after).toEqual(before);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/read-only-print`, title: 'Two renders per voucher: identical content, no journal or status change', routes: ['GET /api/expense-documents/:id/voucher.pdf'], artifacts: [] }));
  });

  it('no outbound transport was used', () => {
    expect(h.external.calls).toEqual([]);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: 'Outbound recorder stayed empty', routes: [], renderer: 'none', artifacts: [] }));
  });
});
