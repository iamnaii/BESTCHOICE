import { randomUUID } from 'crypto';
import request from 'supertest';
import { DOCUMENT_STYLE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { activateContract, createFinancedContract, FinancedContract, grantApprovalPermissions } from './support/receipts-fixtures';
import { recordScenario, saveArtifact, sha256, ScenarioRecord } from './support/artifacts';
import { contentSignature, foldThai, isA4, parsePdf, ParsedPdf, textSizes } from './support/pdf';
import { ReceiptsService } from '../../src/modules/receipts/receipts.service';
import { InstallmentAccrual2ATemplate } from '../../src/modules/journal/cpa-templates/installment-accrual-2a.template';
import { RECEIPT_DOCUMENT_BALANCE_ACTION } from '../../src/modules/receipts/services/receipt-document-balance';

/**
 * DOC-01 (issue #1560): receipts and credit notes produced by the REAL payment,
 * approval, reschedule, early-payoff and repossession services on the disposable
 * database, rendered by the real ReceiptPdfService (Chromium) and downloaded
 * through GET /receipts/:id/pdf — the route every web download button uses
 * (ReceiptsTab, ContractPaymentSchedule, PaymentHistorySheet, RepossessionsPage).
 */
const DOMAIN = 'receipts';
const GUARDS = ['CsrfGuard', 'ThrottlerGuard', 'UserThrottlerGuard (POST /payments/record)', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard', 'BranchGuard', 'ExportEnabledGuard (GET /receipts/:id/pdf)', 'EntityScopeInterceptor', 'AuditInterceptor'];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded by the harness, never sent (credit-note LINE delivery is recorded)',
  'private local directory instead of GCS/S3',
  'company, branches, users, customer, products and contracts are synthetic Prisma rows with test markers; schedules + Payment rows seeded directly, activation journal posted by the real 1A template',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['RECEIPT'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

type ReceiptRow = {
  id: string; receiptNumber: string; receiptType: string; amount: string | number; paymentStatus: string; isVoided: boolean;
  paymentMethod: string | null; installmentNo: number | null; paymentId: string | null; voidedReceiptId: string | null; cnSource: string | null;
  transactionRef: string | null; createdAt: string;
};

const money = (value: string | number | { toString(): string }) => Number(Number(value.toString()).toFixed(2));

describe('DOC-01 receipts & credit notes — real payment services, real renderer, real download route', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let owner: Session, salesA: Session, salesB: Session, accountant: Session, financeManager: Session, branchManagerA: Session;
  let contractA: FinancedContract, contractB: FinancedContract, contractC: FinancedContract, contractD: FinancedContract;
  let payers: Session[] = [];
  let payerIndex = 0;
  const nextPayer = () => payers[payerIndex++ % payers.length];
  const receipts: Partial<Record<'installmentCash' | 'partial' | 'completion' | 'rescheduleFee' | 'legacy' | 'final' | 'downPayment' | 'earlyPayoff' | 'voided' | 'voidCreditNote' | 'repossessionCreditNote' | 'contractB', ReceiptRow>> = {};
  const pdfs = new Map<string, Buffer>();

  const listReceipts = async (contractId: string): Promise<ReceiptRow[]> => {
    const response = await h.client({ session: owner }).get(`/receipts/contract/${contractId}`).query({ includeVoided: 'true' }).expect(200);
    return (Array.isArray(response.body.data) ? response.body.data : response.body.data.data) as ReceiptRow[];
  };
  const findReceipt = async (contractId: string, predicate: (row: ReceiptRow) => boolean): Promise<ReceiptRow> => {
    const rows = (await listReceipts(contractId)).filter(predicate).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!rows.length) throw new Error(`no receipt matched on ${contractId}: ${JSON.stringify(await listReceipts(contractId))}`);
    return rows[rows.length - 1];
  };
  const receiptPdf = async (session: Session | null, id: string): Promise<Buffer> => {
    const response = await h.client({ session }).get(`/receipts/${id}/pdf`).expect(200).expect('Content-Type', /application\/pdf/);
    expect(response.headers['content-disposition']).toContain(`receipt-${id}.pdf`);
    const bytes = bodyBuffer(response);
    pdfs.set(id, bytes);
    return bytes;
  };
  // POST /payments/record: every booking needs a slip or a reference (orchestrator rule), and the
  // route is throttled (@Throttle 5 per 10 s) — pace the calls the way a cashier would.
  // Observed in this harness: the global ThrottlerGuard and the route's UserThrottlerGuard both
  // count the request against the same limit, so the 3rd booking inside 10 s already answers 429
  // — keep at most two bookings per window and keep the X-RateLimit headers as evidence.
  const recordTimes: number[] = [];
  const rateLimitEvidence: Array<Record<string, string | undefined>> = [];
  let referenceSeq = 0;
  const pay = async (session: Session, body: Record<string, unknown>) => {
    const window = recordTimes.filter((at) => Date.now() - at < 11_000);
    if (window.length >= 2) await new Promise((resolve) => setTimeout(resolve, 11_000 - (Date.now() - window[0]) + 250));
    recordTimes.push(Date.now());
    const response = await h.client({ session }).post('/payments/record', { paymentMethod: 'CASH', depositAccountCode: '11-1101', case: 'NORMAL', transactionRef: `${world.prefix}-REF-${++referenceSeq}`, ...body });
    rateLimitEvidence.push({ status: String(response.status), user: session.user.role, limit: response.headers['x-ratelimit-limit-short'], remaining: response.headers['x-ratelimit-remaining-short'] });
    if (response.status !== 201) throw new Error(`POST /payments/record → ${response.status} ${JSON.stringify(response.body)} for ${JSON.stringify(body)}`);
    return response;
  };
  const ok = async (test: request.Test, status = 201, label = 'request'): Promise<request.Response> => {
    const response = await test;
    if (response.status !== status) throw new Error(`${label} → ${response.status} (expected ${status}) ${JSON.stringify(response.body)}`);
    return response;
  };
  const has = (pdf: ParsedPdf, needle: string) => foldThai(pdf.pages.map((page) => page.text).join('\n')).includes(foldThai(needle));
  const expectBaseline = (pdf: ParsedPdf, label: string) => {
    expect({ label, pages: pdf.pageCount }).toEqual({ label, pages: 1 });
    expect(pdf.pages.every(isA4)).toBe(true);
    expect(pdf.fonts.length).toBeGreaterThan(0);
    expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
    expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
  };
  const summary = (pdf: ParsedPdf) => ({ pageCount: pdf.pageCount, fonts: pdf.fonts, sizes: textSizes(pdf).slice(0, 6), lines: pdf.pages[0].lines });
  const savePdf = async (name: string, row: ReceiptRow, bytes: Buffer, extra: Record<string, unknown> = {}) => {
    const pdf = await parsePdf(bytes);
    const a = saveArtifact(DOMAIN, `${name}.pdf`, bytes);
    const b = saveArtifact(DOMAIN, `${name}.pdf.json`, JSON.stringify({ receipt: { id: row.id, receiptNumber: row.receiptNumber, receiptType: row.receiptType, amount: row.amount, paymentStatus: row.paymentStatus, isVoided: row.isVoided, paymentMethod: row.paymentMethod, installmentNo: row.installmentNo, cnSource: row.cnSource }, ...extra, ...summary(pdf) }, null, 2));
    return { pdf, artifacts: [a.relativePath, b.relativePath] };
  };
  const ledger = async () => {
    const payments = await h.prisma.payment.findMany({ where: { contractId: { in: [contractA.id, contractB.id, contractC.id, contractD.id] } }, select: { id: true, amountPaid: true, status: true } });
    return { receipts: await h.prisma.receipt.count(), journalEntries: await h.prisma.journalEntry.count(), payments: payments.map((row) => `${row.id}:${row.status}:${row.amountPaid}`).sort() };
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    [owner, salesA, salesB, accountant, financeManager, branchManagerA] = await Promise.all(
      [world.users.owner, world.users.salesA, world.users.salesB, world.users.accountant, world.users.financeManager, world.users.branchManagerA].map((u) => h.login(u.email, u.password)),
    );
    await grantApprovalPermissions(h.prisma, owner.user.id, ['EARLY_PAYOFF', 'VOID_RECEIPT']);
    const make = async (label: string, branchId: string, salespersonId: string) => {
      const contract = await createFinancedContract(h.prisma, { prefix: world.prefix, label, branchId, customerId: world.customer.id, salespersonId });
      await activateContract(h.app, contract.id);
      return contract;
    };
    contractA = await make('A', world.branches.a.id, world.users.salesA.id);
    contractB = await make('B', world.branches.b.id, world.users.salesB.id);
    contractC = await make('C', world.branches.a.id, world.users.salesA.id);
    contractD = await make('D', world.branches.a.id, world.users.salesA.id);
    // POST /payments/record is throttled to 5 per 10 s per user — rotate real users with branch access.
    payers = [salesA, branchManagerA, owner, financeManager, accountant];
  }, 180000);

  afterAll(async () => { await h?.close(); });

  it('books installment 1 in cash → INSTALLMENT receipt; the PDF is a one-page A4 tax receipt with the booked amount', async () => {
    const total = contractA.installmentTotal.toNumber();
    await pay(salesA, { contractId: contractA.id, installmentNo: 1, amount: total });
    const row = await findReceipt(contractA.id, (r) => r.installmentNo === 1 && !r.isVoided);
    expect(row.receiptType).toBe('INSTALLMENT');
    expect(money(row.amount)).toBe(total);
    expect(row.paymentStatus).toBe('PAID');
    expect(row.paymentId).toBeTruthy();
    expect(row.receiptNumber).toMatch(/^RT-\d{6}-\d{5}$/);
    const payment = await h.prisma.payment.findFirstOrThrow({ where: { contractId: contractA.id, installmentNo: 1 } });
    expect(money(payment.amountPaid)).toBe(total);
    expect(payment.status).toBe('PAID');
    expect(payment.id).toBe(row.paymentId);
    const bytes = await receiptPdf(salesA, row.id);
    const { pdf, artifacts } = await savePdf('installment-cash', row, bytes, { source: { paymentAmountPaid: money(payment.amountPaid), installmentTotal: total } });
    expectBaseline(pdf, 'installment-cash');
    for (const needle of ['ใบเสร็จรับเงิน / ใบกำกับภาษี', row.receiptNumber, world.customer.name, contractA.contractNumber, 'ค่างวดเช่าซื้อ งวดที่ 1/12', 'จำนวนเงินรับชำระทั้งสิ้น', '1,515.83', 'เงินสด', 'ภาษีมูลค่าเพิ่ม 7%', 'ค่างวดคงเหลือ', 'งวดคงเหลือ']) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: true });
    expect(has(pdf, 'บัญชีรับเงิน')).toBe(false);
    expect(has(pdf, 'VOID')).toBe(false);
    // Issuer printed on the PDF is whatever GET /receipts/:id returns as `company`.
    const detail = (await h.client({ session: salesA }).get(`/receipts/${row.id}`).expect(200)).body.data as { company: { nameTh: string; taxId: string } };
    expect(has(pdf, detail.company.nameTh)).toBe(true);
    expect(has(pdf, detail.company.taxId)).toBe(true);
    receipts.installmentCash = row;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/installment-cash`, title: 'Cash installment → INSTALLMENT receipt (RT-YYYYMM-NNNNN), PDF amounts equal Payment.amountPaid, issuer = API company', routes: ['POST /api/payments/record', 'GET /api/receipts/contract/:contractId', 'GET /api/receipts/:id', 'GET /api/receipts/:id/pdf'], artifacts, notes: `Observation: ReceiptQueryService picks the issuer with companyInfo.findFirst({ isActive }) — no companyCode preference; printed here: ${detail.company.nameTh}. Whether FINANCE must always issue installment receipts is an owner decision.` }));
  });

  it('bank-transfer partial then completion → two receipts: partial tag + reference on the first, PAID on the second', async () => {
    const total = contractA.installmentTotal.toNumber();
    const reference = `${world.prefix}-TX-0001`;
    await pay(branchManagerA, { contractId: contractA.id, installmentNo: 2, amount: 800, paymentMethod: 'BANK_TRANSFER', transactionRef: reference, case: 'PARTIAL' });
    const partial = await findReceipt(contractA.id, (r) => r.installmentNo === 2 && !r.isVoided);
    expect(partial.paymentStatus).toBe('PARTIAL');
    expect(money(partial.amount)).toBe(800);
    expect(partial.paymentMethod).toBe('BANK_TRANSFER');
    const partialPdf = await parsePdf(await receiptPdf(branchManagerA, partial.id));
    expectBaseline(partialPdf, 'installment-partial');
    for (const needle of ['ชำระบางส่วน', '800.00', '1,515.83', 'โอนเงินผ่านธนาคาร', 'เลขอ้างอิง', reference]) expect({ needle, found: has(partialPdf, needle) }).toEqual({ needle, found: true });
    const remainder = money(total - 800);
    await pay(owner, { contractId: contractA.id, installmentNo: 2, amount: remainder });
    const completion = await findReceipt(contractA.id, (r) => r.installmentNo === 2 && !r.isVoided && r.id !== partial.id);
    expect(completion.paymentStatus).toBe('PAID');
    expect(money(completion.amount)).toBe(remainder);
    const payment = await h.prisma.payment.findFirstOrThrow({ where: { contractId: contractA.id, installmentNo: 2 } });
    expect(money(payment.amountPaid)).toBe(total);
    const completionPdf = await parsePdf(await receiptPdf(accountant, completion.id));
    expectBaseline(completionPdf, 'installment-completion');
    expect(has(completionPdf, remainder.toLocaleString('en-US', { minimumFractionDigits: 2 }))).toBe(true);
    expect(has(completionPdf, 'ชำระบางส่วน')).toBe(false);
    const artifacts = [
      ...(await savePdf('installment-partial-transfer', partial, pdfs.get(partial.id)!, { source: { paid: 800, installmentTotal: total, reference } })).artifacts,
      ...(await savePdf('installment-completion', completion, pdfs.get(completion.id)!, { source: { paid: remainder, cumulative: money(payment.amountPaid) } })).artifacts,
    ];
    receipts.partial = partial;
    receipts.completion = completion;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/partial-then-complete`, title: 'PARTIAL 800 (BANK_TRANSFER + reference) then 715.83 completion — two receipts, cumulative equals installment', routes: ['POST /api/payments/record', 'GET /api/receipts/:id/pdf'], artifacts }));
  });

  it('reschedule 6a (fee first) → RESCHEDULE_FEE receipt equal to the independent quote, due date shifted, no VAT line', async () => {
    const quoteResponse = await h.client({ session: salesA }).get('/payments/reschedule-quote').query({ contractId: contractA.id, installmentNo: 3, daysToShift: 10, splitMode: 'SPLIT' }).expect(200);
    const quote = quoteResponse.body.data as { collectAmount: string; rescheduleFee: string; lateFee: string };
    expect(money(quote.lateFee)).toBe(0);
    expect(money(quote.rescheduleFee)).toBeGreaterThan(0);
    expect(money(quote.collectAmount)).toBe(money(quote.rescheduleFee));
    const before = await h.prisma.payment.findFirstOrThrow({ where: { contractId: contractA.id, installmentNo: 3 } });
    await pay(financeManager, { contractId: contractA.id, installmentNo: 3, amount: money(quote.collectAmount), case: 'RESCHEDULE', splitMode: 'SPLIT', daysToShift: 10 });
    const after = await h.prisma.payment.findFirstOrThrow({ where: { contractId: contractA.id, installmentNo: 3 } });
    expect(Math.round((after.dueDate.getTime() - before.dueDate.getTime()) / 86_400_000)).toBe(10);
    expect(money(after.amountPaid)).toBe(0);
    const row = await findReceipt(contractA.id, (r) => r.receiptType === 'RESCHEDULE_FEE');
    expect(money(row.amount)).toBe(money(quote.collectAmount));
    expect(row.installmentNo).toBe(3);
    const bytes = await receiptPdf(salesA, row.id);
    const { pdf, artifacts } = await savePdf('reschedule-fee', row, bytes, { source: quote, dueDateBefore: before.dueDate, dueDateAfter: after.dueDate });
    expectBaseline(pdf, 'reschedule-fee');
    // 6a books the fee as an advance parked against the last installment (21-1103), so the line
    // reads "เงินรับล่วงหน้างวดที่ 12/12 — ปรับดิว … พักไว้หักค่างวดสุดท้าย" rather than a fee item.
    for (const needle of ['ปรับดิว', 'เงินรับล่วงหน้า', 'พักไว้หักค่างวดสุดท้าย', money(quote.collectAmount).toLocaleString('en-US', { minimumFractionDigits: 2 }), 'ใบเสร็จรับเงิน']) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: true });
    expect(has(pdf, 'ใบกำกับภาษี')).toBe(false);
    receipts.rescheduleFee = row;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/reschedule-fee`, title: 'RESCHEDULE_FEE receipt (6a split) equals GET /payments/reschedule-quote; installment 3 shifted 10 days; printed as parked advance, no VAT', routes: ['GET /api/payments/reschedule-quote', 'POST /api/payments/record', 'GET /api/receipts/:id/pdf'], artifacts, notes: 'itemLabel RESCHEDULE_FEE ("ค่าธรรมเนียมเลื่อนนัดชำระ") is not what prints — the advance-only branch labels the line "เงินรับล่วงหน้างวดที่ 12/12 — ปรับดิว"; matches the 21-1103 accounting of 6a' }));
  });

  it('pays the remaining installments: a receipt without its balance snapshot stays "unknown", the last receipt prints a known zero balance', async () => {
    const total = contractA.installmentTotal.toNumber();
    for (let installmentNo = 3; installmentNo <= 12; installmentNo += 1) {
      await pay(nextPayer(), { contractId: contractA.id, installmentNo, amount: total });
    }
    const contract = await h.prisma.contract.findUniqueOrThrow({ where: { id: contractA.id } });
    const unpaid = await h.prisma.payment.count({ where: { contractId: contractA.id, status: { not: 'PAID' } } });
    expect(unpaid).toBe(0);

    const legacy = await findReceipt(contractA.id, (r) => r.installmentNo === 4 && r.receiptType === 'INSTALLMENT');
    const snapshot = await h.prisma.auditLog.findFirst({ where: { action: RECEIPT_DOCUMENT_BALANCE_ACTION, entityId: legacy.id } });
    expect(snapshot).not.toBeNull();
    const knownPdf = await parsePdf(await receiptPdf(owner, legacy.id));
    expect(has(knownPdf, 'ค่างวดคงเหลือ')).toBe(true);
    // audit_logs is append-only (DB trigger). The reader treats more than one snapshot row for a
    // receipt as unreliable → unknown, so a second snapshot models an unprovable legacy balance.
    await h.prisma.auditLog.create({ data: { userId: owner.user.id, action: RECEIPT_DOCUMENT_BALANCE_ACTION, entity: 'receipt', entityId: legacy.id, newValue: { ...(snapshot!.newValue as object), note: 'ทดสอบระบบ duplicate snapshot' } } });
    const legacyBytes = await receiptPdf(owner, legacy.id);
    const legacyPdf = await parsePdf(legacyBytes);
    expectBaseline(legacyPdf, 'legacy-unknown');
    expect(has(legacyPdf, 'ไม่สามารถยืนยันยอด ณ วันออกใบเสร็จจากประวัติได้')).toBe(true);
    expect(has(legacyPdf, 'ค่างวดคงเหลือ')).toBe(false);
    expect(has(legacyPdf, '1,515.83')).toBe(true);

    const final = await findReceipt(contractA.id, (r) => r.installmentNo === 12 && r.receiptType === 'INSTALLMENT');
    const finalBytes = await receiptPdf(owner, final.id);
    const finalPdf = await parsePdf(finalBytes);
    expectBaseline(finalPdf, 'final-zero');
    for (const needle of ['ค่างวดคงเหลือ', '0.00 บาท', 'ชำระครบตามเอกสารนี้', 'งวดที่ 12/12']) expect({ needle, found: has(finalPdf, needle) }).toEqual({ needle, found: true });
    expect(has(finalPdf, 'ไม่สามารถยืนยันยอด')).toBe(false);
    const artifacts = [
      ...(await savePdf('installment-legacy-unknown-balance', legacy, legacyBytes, { simulation: 'second RECEIPT_DOCUMENT_BALANCE_V1 audit row inserted (audit_logs is append-only) so the snapshot is ambiguous → unknown' })).artifacts,
      ...(await savePdf('installment-final-zero-balance', final, finalBytes, { contractStatus: contract.status })).artifacts,
    ];
    receipts.legacy = legacy;
    receipts.final = final;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/unknown-vs-zero`, title: 'Unreliable balance snapshot prints "unknown" (never 0); fully paid contract prints 0.00 + ชำระครบ', routes: ['POST /api/payments/record', 'GET /api/receipts/:id/pdf'], artifacts, simulated: [...SIMULATED, 'legacy row modelled by inserting a second RECEIPT_DOCUMENT_BALANCE_V1 snapshot (reader → unknown); rows are append-only so the original cannot be removed'], notes: `contract status after 12/12: ${contract.status}` }));
  });

  it('DOWN_PAYMENT receipt through the real issuance service prints เงินดาวน์ without VAT (no production route issues this type today)', async () => {
    const service = h.app.get(ReceiptsService);
    const issued = await service.generateReceipt(contractA.id, null, 'DOWN_PAYMENT', 2000, null, 'CASH', null, owner.user.id);
    const row = await findReceipt(contractA.id, (r) => r.receiptType === 'DOWN_PAYMENT');
    expect(row.id).toBe(issued.id);
    expect(money(row.amount)).toBe(2000);
    const contract = await h.prisma.contract.findUniqueOrThrow({ where: { id: contractA.id } });
    expect(money(contract.downPayment)).toBe(2000);
    const bytes = await receiptPdf(salesA, row.id);
    const { pdf, artifacts } = await savePdf('down-payment', row, bytes, { source: { contractDownPayment: money(contract.downPayment) } });
    expectBaseline(pdf, 'down-payment');
    for (const needle of ['เงินดาวน์', '2,000.00', 'ใบเสร็จรับเงิน', 'เงินสด']) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: true });
    expect(has(pdf, 'ใบกำกับภาษี')).toBe(false);
    receipts.downPayment = row;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/down-payment`, title: 'DOWN_PAYMENT receipt = contract.downPayment, no VAT lines', routes: ['GET /api/receipts/:id/pdf'], source: 'service', artifacts, simulated: [...SIMULATED, 'issued via ReceiptsService.generateReceipt — apps/api has no route or workflow that issues DOWN_PAYMENT receipts (only legacy/seed rows)'], notes: 'Finding for the owner: booking/contract creation does not issue a DOWN_PAYMENT receipt in the current API' }));
  });

  it('early payoff through the approval workflow → EARLY_PAYOFF receipt equal to the quote, contract closed', async () => {
    const quote = (await h.client({ session: salesA }).get(`/contracts/${contractC.id}/early-payoff-quote`).expect(200)).body.data as { totalPayoff: string | number };
    expect(money(quote.totalPayoff)).toBeGreaterThan(0);
    const request = await h.client({ session: salesA }).post('/payments/approval-requests', { action: 'EARLY_PAYOFF', targetId: contractC.id, reason: `${world.prefix} ทดสอบระบบ ปิดยอดก่อนกำหนด`, payload: { paymentMethod: 'CASH' } }).expect(201);
    const requestId = request.body.data.id as string;
    await h.client({ session: salesB }).post(`/payments/approval-requests/${requestId}/approve`, { reason: 'ไม่มีสิทธิ์' }).expect(403);
    await h.client({ session: owner }).post(`/payments/approval-requests/${requestId}/approve`, { reason: 'OWNER ตรวจสอบรายการทดสอบแล้ว' }).expect(201);
    const row = await findReceipt(contractC.id, (r) => r.receiptType === 'EARLY_PAYOFF');
    expect(money(row.amount)).toBe(money(quote.totalPayoff));
    const contract = await h.prisma.contract.findUniqueOrThrow({ where: { id: contractC.id } });
    expect(['EARLY_PAYOFF', 'COMPLETED']).toContain(contract.status);
    const approval = await h.prisma.paymentApprovalRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(approval.status).toBe('APPROVED');
    expect(approval.reviewedById).toBe(owner.user.id);
    const bytes = await receiptPdf(accountant, row.id);
    const { pdf, artifacts } = await savePdf('early-payoff', row, bytes, { source: { quoteTotalPayoff: money(quote.totalPayoff), contractStatus: contract.status } });
    expectBaseline(pdf, 'early-payoff');
    for (const needle of ['ปิดยอดสัญญาก่อนกำหนด', money(quote.totalPayoff).toLocaleString('en-US', { minimumFractionDigits: 2 }), contractC.contractNumber]) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: true });
    receipts.earlyPayoff = row;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/early-payoff`, title: 'SALES requests, OWNER approves (SALES other branch 403) → EARLY_PAYOFF receipt = GET early-payoff-quote.totalPayoff', routes: ['GET /api/contracts/:id/early-payoff-quote', 'POST /api/payments/approval-requests', 'POST /api/payments/approval-requests/:id/approve', 'GET /api/receipts/:id/pdf'], artifacts }));
  });

  it('void through the approval workflow → original prints VOID overlay, credit note prints ใบลดหนี้ for the same amount', async () => {
    const total = contractB.installmentTotal.toNumber();
    await pay(salesB, { contractId: contractB.id, installmentNo: 1, amount: total });
    const original = await findReceipt(contractB.id, (r) => r.installmentNo === 1 && r.receiptType === 'INSTALLMENT');
    receipts.contractB = original;
    const request = await ok(h.client({ session: salesB }).post('/payments/approval-requests', { action: 'VOID_RECEIPT', targetId: original.id, reason: 'ทดสอบระบบ ยกเลิกใบเสร็จ', payload: {} }), 201, 'VOID_RECEIPT request');
    const requestId = (request.body as { data: { id: string } }).data.id;
    // A second pending request for the same receipt is refused — one open request per target.
    await h.client({ session: financeManager }).post('/payments/approval-requests', { action: 'VOID_RECEIPT', targetId: original.id, reason: 'ซ้ำ', payload: {} }).expect(409);
    await h.client({ session: salesB }).post(`/payments/approval-requests/${requestId}/approve`, { reason: 'ผู้ขอเอง' }).expect(403);
    await ok(h.client({ session: owner }).post(`/payments/approval-requests/${requestId}/approve`, { reason: 'OWNER ตรวจสอบแล้ว' }), 201, 'VOID_RECEIPT approve');
    const voided = await findReceipt(contractB.id, (r) => r.id === original.id);
    expect(voided.isVoided).toBe(true);
    const creditNote = await findReceipt(contractB.id, (r) => r.receiptType === 'CREDIT_NOTE' && r.voidedReceiptId === original.id);
    expect(money(creditNote.amount)).toBe(money(original.amount));
    expect(creditNote.cnSource).toBeNull();
    const payment = await h.prisma.payment.findFirstOrThrow({ where: { contractId: contractB.id, installmentNo: 1 } });
    expect(payment.status).not.toBe('PAID');
    const voidedBytes = await receiptPdf(owner, original.id);
    const voidedPdf = await parsePdf(voidedBytes);
    expectBaseline(voidedPdf, 'voided');
    expect(has(voidedPdf, 'VOID')).toBe(true);
    const cnBytes = await receiptPdf(owner, creditNote.id);
    const cnPdf = await parsePdf(cnBytes);
    expectBaseline(cnPdf, 'void-credit-note');
    for (const needle of ['ใบลดหนี้', 'ลดหนี้ — ยกเลิกใบเสร็จ', 'ยอดลดหนี้ทั้งสิ้น', '1,515.83', creditNote.receiptNumber]) expect({ needle, found: has(cnPdf, needle) }).toEqual({ needle, found: true });
    const artifacts = [
      ...(await savePdf('installment-voided', voided, voidedBytes, { source: { paymentStatusAfterVoid: payment.status } })).artifacts,
      ...(await savePdf('credit-note-void', creditNote, cnBytes, { source: { voidedReceiptId: original.id, originalAmount: money(original.amount) } })).artifacts,
    ];
    receipts.voided = voided;
    receipts.voidCreditNote = creditNote;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/void-credit-note`, title: 'VOID_RECEIPT request + OWNER approval → isVoided + CREDIT_NOTE (voidedReceiptId), payment reopened, PDFs show VOID / ใบลดหนี้', documents: ['RECEIPT', 'CREDIT_NOTE'], routes: ['POST /api/payments/record', 'POST /api/payments/approval-requests', 'POST /api/payments/approval-requests/:id/approve', 'GET /api/receipts/:id/pdf'], artifacts }));
  });

  it('repossession issues a มาตรา 82/5 credit note reachable from the repossession list and the public token link', async () => {
    await pay(salesA, { contractId: contractD.id, installmentNo: 1, amount: contractD.installmentTotal.toNumber() });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    // A มาตรา 82/5 credit note covers installments whose income was accrued (2A journal) but never
    // paid. The monthly accrual cron is outside this flow, so post 2A for installments 2 and 3 the
    // way the cron does, then mark the contract overdue (JP5 accepts TERMINATED / DEFAULT / OVERDUE).
    const accrual = h.app.get(InstallmentAccrual2ATemplate);
    const accrued: string[] = [];
    for (const installmentNo of [2, 3]) {
      const schedule = await h.prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: contractD.id, installmentNo } });
      const posted = await accrual.execute(schedule.id);
      expect(posted?.entryNo).toBeTruthy();
      accrued.push(posted!.entryNo);
    }
    await h.prisma.contract.update({ where: { id: contractD.id }, data: { status: 'OVERDUE' } });
    await h.client({ session: salesA }).post('/repossessions', { contractId: contractD.id, repossessedDate: today, conditionGrade: 'B', appraisalPrice: 3000 }).expect(403);
    const created = await ok(h.client({ session: owner }).post('/repossessions', { contractId: contractD.id, repossessedDate: today, conditionGrade: 'B', appraisalPrice: 3000, returnReason: 'UNAFFORDABLE', notes: 'ทดสอบระบบ ยึดคืน' }), 201, 'POST /repossessions');
    const creditNote = created.body.data.creditNote as { outcome: string; receiptId?: string };
    expect(creditNote.outcome).toBe('ISSUED');
    const listing = await h.client({ session: accountant }).get('/repossessions').expect(200);
    const rows = (Array.isArray(listing.body.data) ? listing.body.data : listing.body.data.data) as Array<{ contractId: string; creditNote?: { receiptId: string; receiptNumber: string } }>;
    const listed = rows.find((row) => row.contractId === contractD.id);
    expect(listed?.creditNote?.receiptId).toBe(creditNote.receiptId);
    const row = await findReceipt(contractD.id, (r) => r.receiptType === 'CREDIT_NOTE');
    expect(row.id).toBe(creditNote.receiptId);
    expect(row.cnSource).toBe('REPOSSESSION');
    const stored = await h.prisma.receipt.findUniqueOrThrow({ where: { id: row.id } });
    expect(money(stored.amountBeforeVat ?? 0) + money(stored.vatAmount ?? 0)).toBeCloseTo(money(stored.amount), 2);
    expect(stored.publicToken).toBeTruthy();
    const bytes = await receiptPdf(owner, row.id);
    const { pdf, artifacts } = await savePdf('credit-note-repossession', row, bytes, { source: { amountBeforeVat: money(stored.amountBeforeVat ?? 0), vatAmount: money(stored.vatAmount ?? 0), amount: money(stored.amount), sourceJournalEntryId: stored.sourceJournalEntryId } });
    expectBaseline(pdf, 'credit-note-repossession');
    for (const needle of ['ใบลดหนี้', 'มาตรา 82/5', contractD.contractNumber, 'ยอดลดหนี้ทั้งสิ้น', money(stored.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })]) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: true });
    const anonymous = h.client({ session: null, company: null });
    const shared = await anonymous.get(`/receipts/public/${stored.publicToken}/pdf`).expect(200).expect('Content-Type', /application\/pdf/);
    expect(contentSignature(await parsePdf(bodyBuffer(shared)))).toBe(contentSignature(pdf));
    expect(shared.headers['cache-control']).toContain('no-store');
    // Two accrued, unpaid installments → 2 × 1,515.83, pro-rated VAT 7/107.
    expect(money(stored.amount)).toBe(money(contractD.installmentTotal.mul(2)));
    for (const needle of ['ลดหนี้ — ยกเลิกใบเสร็จ', money(stored.amountBeforeVat ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 }), money(stored.vatAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })]) expect({ needle, found: has(pdf, needle) }).toEqual({ needle, found: true });
    await anonymous.get(`/receipts/public/${randomUUID()}/pdf`).expect(404);
    const lineCalls = h.external.calls.filter((call) => call.channel === 'line');
    expect(lineCalls.every((call) => call.recipient.startsWith('TEST-NOT-SENT'))).toBe(true);
    receipts.repossessionCreditNote = row;
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/credit-note-repossession`, title: 'POST /repossessions → CREDIT_NOTE for 2 accrued unpaid installments (cnSource REPOSSESSION, VAT split) listed on GET /repossessions; staff PDF and public token PDF carry the same content', documents: ['CREDIT_NOTE'], routes: ['POST /api/repossessions', 'GET /api/repossessions', 'GET /api/receipts/:id/pdf', 'GET /api/receipts/public/:token/pdf'], artifacts, simulated: [...SIMULATED, '2A accrual posted for installments 2–3 through the real template (cron outside this flow)', 'contract status set to OVERDUE directly (overdue cron outside this flow)'], notes: `accrual entries ${accrued.join(', ')}; LINE delivery attempts recorded: ${lineCalls.length}. Observations for the owner: (1) Receipt.itemDescription ("ใบลดหนี้ยกเลิกงวดค้าง 2 งวด — เลิกสัญญา (ม.82/5)") is stored but the PDF prints the generic "ลดหนี้ — ยกเลิกใบเสร็จ"; (2) the status block prints the void-CN wording "กลับรายการ — งวดนี้กลับเป็นยอดค้างชำระ" on a repossession CN; (3) issuer = first active company_info row (SHOP here).` }));
  });

  it('enforces branch, role, export flag and unknown IDs on the download route; denials carry JSON, never bytes', async () => {
    const a = receipts.installmentCash!;
    const b = receipts.contractB!;
    for (const [session, id] of [[salesB, a.id], [salesA, b.id]] as Array<[Session, string]>) {
      const response = await h.client({ session }).get(`/receipts/${id}/pdf`).expect(403);
      expect(response.headers['content-type']).toMatch(/json/);
    }
    await h.client({ session: null }).get(`/receipts/${a.id}/pdf`).expect(401);
    await h.client({ session: owner }).get(`/receipts/${randomUUID()}/pdf`).expect(404);
    // Same rule on the other receipt-addressed reads and on the list.
    await h.client({ session: salesB }).get(`/receipts/${a.id}`).expect(403);
    await h.client({ session: salesB }).get(`/receipts/number/${a.receiptNumber}`).expect(403);
    await h.client({ session: salesB }).get(`/receipts/contract/${contractA.id}`).expect(403);
    await h.client({ session: salesB }).get('/receipts').query({ branchId: world.branches.a.id }).expect(403);
    const scoped = await h.client({ session: salesB }).get('/receipts').query({ limit: 100 }).expect(200);
    const scopedRows = scoped.body.data.data as Array<{ id: string }>;
    expect(scopedRows.length).toBeGreaterThan(0);
    const scopedBranches = await h.prisma.receipt.findMany({ where: { id: { in: scopedRows.map((row) => row.id) } }, select: { contract: { select: { branchId: true } } } });
    expect(new Set(scopedBranches.map((row) => row.contract.branchId))).toEqual(new Set([world.branches.b.id]));
    expect((await h.client({ session: owner }).get('/receipts').query({ limit: 100 }).expect(200)).body.data.total).toBeGreaterThan(scopedRows.length);
    await h.client({ session: salesA, company: 'FINANCE' }).get(`/receipts/${a.id}/pdf`).expect(403);
    expect(contentSignature(await parsePdf(await receiptPdf(accountant, b.id)))).toBe(contentSignature(await parsePdf(await receiptPdf(owner, b.id))));
    await h.client({ session: salesA }).post(`/receipts/${a.id}/void`, { reason: 'x', approvedById: owner.user.id }).expect(403);
    const flag = await h.prisma.systemConfig.upsert({ where: { key: 'export_enabled' }, update: { value: 'false', deletedAt: null }, create: { key: 'export_enabled', value: 'false' } });
    try {
      const blocked = await h.client({ session: owner }).get(`/receipts/${a.id}/pdf`).expect(403);
      expect(blocked.headers['content-type']).toMatch(/json/);
    } finally {
      await h.prisma.systemConfig.update({ where: { id: flag.id }, data: { value: 'true' } });
    }
    await h.client({ session: owner }).get(`/receipts/${a.id}/pdf`).expect(200);
    const evidence = saveArtifact(DOMAIN, 'payments-record-rate-limit.json', JSON.stringify(rateLimitEvidence, null, 2));
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/authorization`, title: 'SALES other branch 403 on pdf/detail/number/contract/list (ReceiptAccessGuard — defect found + fixed), no token 401, unknown id 404, ?company=finance 403, export_enabled=false 403, SALES cannot void', routes: ['GET /api/receipts/:id/pdf', 'GET /api/receipts/:id', 'GET /api/receipts/number/:receiptNumber', 'GET /api/receipts/contract/:contractId', 'GET /api/receipts', 'POST /api/receipts/:id/void'], renderer: 'none', artifacts: [evidence.relativePath], notes: 'Before this change BranchGuard only checked an explicit branchId param, so SALES could download any branch\'s receipt by id. Rate-limit headers of POST /payments/record recorded in the artifact: the 3rd booking within 10 s answers 429 (global + user throttler share the limit) — observation for the payments owner.' }));
  });

  it('viewing and downloading receipts repeatedly never books money, receipts or journal entries again', async () => {
    const before = await ledger();
    for (const row of [receipts.installmentCash!, receipts.rescheduleFee!, receipts.earlyPayoff!, receipts.voidCreditNote!, receipts.repossessionCreditNote!]) {
      const first = contentSignature(await parsePdf(await receiptPdf(owner, row.id)));
      const second = contentSignature(await parsePdf(await receiptPdf(owner, row.id)));
      expect(first).toBe(second);
      await h.client({ session: owner }).get(`/receipts/${row.id}`).expect(200);
    }
    await h.client({ session: owner }).get('/receipts').query({ limit: 100 }).expect(200);
    await listReceipts(contractA.id);
    expect(await ledger()).toEqual(before);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/read-only-downloads`, title: 'Two downloads + detail + list per receipt: receipt/journal counts and Payment.amountPaid unchanged; rendered content identical', routes: ['GET /api/receipts/:id/pdf', 'GET /api/receipts/:id', 'GET /api/receipts', 'GET /api/receipts/contract/:contractId'], artifacts: [], notes: 'Receipt PDFs are rendered on every request (not stored): bytes differ per render even with dates stripped, so equality is asserted on parsed content (fonts, page boxes, text lines)' }));
  });

  it('only recorded LINE deliveries to synthetic recipients left the process', () => {
    expect(h.external.calls.filter((call) => call.channel !== 'line')).toEqual([]);
    expect(h.external.calls.every((call) => call.recipient.startsWith('TEST-NOT-SENT'))).toBe(true);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: `Outbound recorder: ${h.external.calls.length} LINE call(s) captured, 0 sent; no SMS/e-mail`, routes: [], renderer: 'none', artifacts: [] }));
  });
});
