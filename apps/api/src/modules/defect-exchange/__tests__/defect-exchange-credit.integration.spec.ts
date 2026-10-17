/**
 * 15ข — เปลี่ยนเครื่องตำหนิเมื่อสัญญาเดิมมีการชำระแล้ว บน DB จริง (vitest — jest ignore *.integration.spec.ts).
 * Wiring ด้วย `new` ตาม precedent accrue-at-receipt.integration.spec.ts (ไม่ผ่าน Nest DI).
 *
 * Runner:
 *   source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && \
 *   npx vitest run --root /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api --no-file-parallelism \
 *     src/modules/defect-exchange/__tests__/defect-exchange-credit.integration.spec.ts
 * CI: glob DEFECT_FILES ใน .github/workflows/deploy-gcp.yml (โฟลเดอร์ใหม่ ⇒ glob ใหม่ — glob ไม่ recurse เอง)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AccountingPeriodStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { glContractBalance } from '../../journal/gl-contract-balance';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { ReceiptVoidReversalTemplate } from '../../journal/cpa-templates/receipt-void-reversal.template';
import { DefectExchangeReversalTemplate } from '../../journal/cpa-templates/defect-exchange-reversal.template';
import { ADVANCE_VAT_META, advanceVatOutstanding } from '../../journal/advance-vat';
import { ReceiptsService } from '../../receipts/receipts.service';
import { ReceiptNumberService } from '../../receipts/services/receipt-number.service';
import { PaymentReceiptOrchestrator } from '../../payments/services/payment-receipt-orchestrator';
import { seedStatementReview } from '../../contracts/__tests__/credit-approval.fixture';
import { DefectExchangeService } from '../defect-exchange.service';
import { DEFECT_EXCHANGE_CN_SOURCE, EXCHANGE_BLOCK_RESCHEDULED } from '../defect-exchange-credit';
import * as Sentry from '@sentry/nestjs';
import { applyExchangeCreditAfterActivation } from '../../contracts/services/exchange-credit-autoapply';

vi.mock('@sentry/nestjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nestjs')>();
  return { ...actual, captureMessage: vi.fn(), captureException: vi.fn() };
});

const prisma = new PrismaClient();
const D = (n: string | number) => new Decimal(n);
const DAY_MS = 86_400_000;
const INSTALLMENT_TOTAL = '1515.83';
const OWNER = { id: '', role: 'OWNER', branchId: null as string | null };

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE', taxId: '0000000000003', companyCode: 'FINANCE', address: '1 Finance Rd.',
        directorName: 'Test Director', vatRegistered: true, vatRate: D('0.0700'),
      },
    });
  }
}
async function ensureSystemAdminUser(): Promise<string> {
  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: { email: 'admin@bestchoice.com', password: 'hashed_placeholder', name: 'System Admin', role: 'OWNER' },
  });
  return created.id;
}
const reopenedFinancePeriods: { id: string; status: AccountingPeriodStatus }[] = [];
async function ensureFinancePeriodsOpen(): Promise<void> {
  const finance = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE' } });
  const months = new Map<string, { year: number; month: number }>();
  for (let offset = -10; offset <= 1; offset++) {
    const day = new Date(Date.now() + offset * DAY_MS);
    months.set(`${day.getFullYear()}-${day.getMonth() + 1}`, { year: day.getFullYear(), month: day.getMonth() + 1 });
  }
  const closed = await prisma.accountingPeriod.findMany({
    where: { companyId: finance.id, status: { in: ['CLOSED', 'SYNCED'] }, OR: [...months.values()] },
    select: { id: true, status: true },
  });
  if (closed.length === 0) return;
  reopenedFinancePeriods.push(...closed);
  await prisma.accountingPeriod.updateMany({ where: { id: { in: closed.map((p) => p.id) } }, data: { status: 'OPEN' } });
}
async function restoreFinancePeriods(): Promise<void> {
  const rows = reopenedFinancePeriods.splice(0);
  for (const status of new Set(rows.map((r) => r.status))) {
    await prisma.accountingPeriod.updateMany({
      where: { id: { in: rows.filter((r) => r.status === status).map((r) => r.id) } },
      data: { status },
    });
  }
}
async function cleanLedger(): Promise<void> {
  await prisma.receipt.deleteMany({});
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.loyaltyPoint.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.creditCheck.deleteMany({ where: { statementFiles: { has: 'synthetic://integration-statement.pdf' } } });
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
  await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
}

/** ยอดทั้งบัญชี (ทุกสัญญา) — ใช้ยืนยันว่า 21-1106 สุทธิ 0 และ 21-2101 สุทธิเท่าภาษีของเงินสดจริง */
async function accountNet(accountCode: string, side: 'cr' | 'dr'): Promise<Decimal> {
  const lines = await prisma.journalLine.findMany({
    where: { accountCode, journalEntry: { status: 'POSTED', deletedAt: null } },
    select: { debit: true, credit: true },
  });
  return lines.reduce(
    (b, l) => (side === 'cr' ? b.plus(l.credit.toString()).minus(l.debit.toString()) : b.plus(l.debit.toString()).minus(l.credit.toString())),
    D(0),
  );
}
const metaOf = (e: { metadata: unknown }) => (e.metadata ?? {}) as Record<string, unknown>;
async function entriesOf(contractId: string) {
  return prisma.journalEntry.findMany({
    where: { status: 'POSTED', deletedAt: null, metadata: { path: ['contractId'], equals: contractId } },
    include: { lines: true },
    orderBy: { createdAt: 'asc' },
  });
}
const sortedLines = (e: { lines: { accountCode: string; debit: unknown; credit: unknown }[] }) =>
  e.lines.map((l) => `${l.accountCode}:${D(String(l.debit)).toFixed(2)}:${D(String(l.credit)).toFixed(2)}`).sort();

describe('15ข — เปลี่ยนเครื่องตำหนิเมื่อสัญญาเดิมมีการชำระแล้ว (integration)', () => {
  let journal: JournalAutoService;
  let orchestrator: PaymentReceiptOrchestrator;
  let defect: DefectExchangeService;
  let recordedById: string;
  const futureDue = () => new Date(Date.now() + 60 * DAY_MS);

  /** สัญญามาตรฐาน 17,000/12 + 1A + งวดในอนาคต + แถว Payment ของงวดที่ระบุ · เครื่องมือสอง รับเครื่องวันนี้ */
  const seedContract = async (opts: { dueDate: Date; paymentRows: number[] }) => {
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as never).execute(c.id);
    await prisma.installmentSchedule.updateMany({ where: { contractId: c.id }, data: { dueDate: opts.dueDate } });
    for (const installmentNo of opts.paymentRows) {
      await prisma.payment.create({
        data: { contractId: c.id, installmentNo, dueDate: opts.dueDate, amountDue: D(INSTALLMENT_TOTAL), status: 'PENDING' },
      });
    }
    const row = await prisma.contract.update({
      where: { id: c.id },
      data: { status: 'ACTIVE', deviceReceivedAt: new Date() },
      select: { id: true, contractNumber: true, customerId: true, productId: true, branchId: true },
    });
    await prisma.product.update({ where: { id: row.productId }, data: { category: 'PHONE_USED', status: 'SOLD_INSTALLMENT' } });
    const old = await prisma.product.findUniqueOrThrow({ where: { id: row.productId } });
    const replacement = await prisma.product.create({
      data: {
        name: 'Replacement Phone', brand: old.brand, model: old.model, storage: old.storage, category: 'PHONE_USED',
        status: 'IN_STOCK', imeiSerial: `DXR-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, costPrice: D('8000'),
        cashPrice: D('12000'), installmentPrice: D('17000'), branchId: row.branchId, ownedByCompanyId: old.ownedByCompanyId,
      },
    });
    await seedStatementReview(prisma, row.customerId);
    return { ...row, replacementId: replacement.id };
  };

  const record = (contractId: string, installmentNo: number, amount: number, ref: string, paymentCase?: 'PARTIAL') =>
    orchestrator.recordPayment(
      contractId, installmentNo, amount, 'BANK_TRANSFER', recordedById,
      undefined, undefined, ref, '11-1201', undefined, paymentCase, undefined, undefined, undefined, undefined, undefined, true,
    );

  const exchange = (oldContractId: string, newProductId: string) =>
    defect.execute({ oldContractId, newProductId, defectReason: 'จอมีเส้น' } as never, OWNER);

  /** กล่องยืนยัน (checkEligibility.creditToTransfer) ต้องเท่ากับ T ที่ลงจริง — preview === posted (ผู้ตรวจอิสระ I2) */
  const eligCredit = async (oldContractId: string, newProductId: string) =>
    (await defect.checkEligibility(oldContractId, newProductId)).creditToTransfer;
  /** Sentry `close-advance-ledger-mismatch` ถูกส่งหลัง commit หรือไม่ (ผู้ตรวจอิสระ I1 — ต้องไม่เตือนเท็จ) */
  const mismatchWarned = () =>
    vi.mocked(Sentry.captureMessage).mock.calls.some((call) => JSON.stringify(call[1] ?? {}).includes('close-advance-ledger-mismatch'));

  /** จำลองการเปิดใช้สัญญาใหม่ที่หน้าสัญญา (precedent after-sales-exchange.integration เคส 5) — 1A + ตารางงวด + ACTIVE */
  const activateNew = async (oldId: string, newId: string) => {
    await prisma.contract.update({ where: { id: newId }, data: { status: 'ACTIVE', workflowStatus: 'APPROVED' } });
    await new ContractActivation1ATemplate(journal, prisma as never).execute(newId);
    const sched = await prisma.installmentSchedule.findMany({ where: { contractId: oldId } });
    await prisma.installmentSchedule.createMany({
      data: sched.map((s) => ({ contractId: newId, installmentNo: s.installmentNo, dueDate: s.dueDate, principal: s.principal, interest: s.interest, amountDue: s.amountDue })),
    });
  };

  beforeAll(async () => {
    await cleanLedger();
    await seedFinanceCoa(prisma);
    await prisma.chartOfAccount.upsert({
      where: { code: '21-5101' },
      create: { code: '21-5101', name: 'เงินเกินของลูกค้า (Customer Credit Balance)', type: 'หนี้สิน', normalBalance: 'Cr', category: 'หนี้สิน' },
      update: { deletedAt: null },
    });
    await ensureFinanceCompany();
    OWNER.id = await ensureSystemAdminUser();
    await ensureFinancePeriodsOpen();
    journal = new JournalAutoService(prisma as never);
    const voidReversal = new ReceiptVoidReversalTemplate(journal, prisma as never);
    const receiptsService = new ReceiptsService(prisma as never, journal, voidReversal, undefined);
    const noop = async () => {};
    orchestrator = new PaymentReceiptOrchestrator(
      prisma as never, receiptsService, { logPaymentEvent: noop, log: noop } as never, journal,
      { transferOwnership: noop } as never, { reverseStageOnPayment: noop } as never,
      new PaymentReceiptTemplate(journal, prisma as never), { execute: noop } as never,
      { awardLoyaltyPoints: noop, sendPaymentSuccessLine: noop, runMdmAutoUnlock: noop, checkPromiseAfterPayment: noop },
    );
    defect = new DefectExchangeService(
      prisma as never, journal, new DefectExchangeReversalTemplate(journal, prisma as never),
      { markReplaced: noop } as never, voidReversal, new ReceiptNumberService(prisma as never),
    );
    await seedStandard17k12m(prisma);
    recordedById = (await prisma.user.findFirstOrThrow({ where: { email: 'test-salesperson@bestchoice-test.internal' } })).id;
  });

  afterAll(async () => {
    try { await cleanLedger(); } finally { try { await restoreFinancePeriods(); } finally { await prisma.$disconnect(); } }
  });

  it('1) ตัวเลขทอง spec §4: จ่ายงวด 1 ก่อนครบกำหนด → เปลี่ยนเครื่อง → ใบลดหนี้ 1 ใบ · ธนาคารไม่ขยับ · 21-1106 สุทธิ 0 · เครดิตใหม่ 1,515.83 · ภ.พ.30 สุทธิ 0 → เปิดใช้ + ใช้เครดิต → ใบใหม่ VAT 99.17 · สุทธิ 99.17', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    await record(c.id, 1, 1515.83, 'ref-g1');
    expect((await accountNet('21-2101', 'cr')).toFixed(2)).toBe('99.17');
    const bankBefore = await accountNet('11-1201', 'dr');

    const est = await eligCredit(c.id, c.replacementId);
    const res = await exchange(c.id, c.replacementId);
    expect(est).toBe(res.transferredCredit); // กล่องยืนยัน === T ที่ลงจริง (I2)
    expect(res.transferredCredit).toBe('1515.83');
    expect(res.creditNoteNumbers).toHaveLength(1);
    expect(res.creditOutEntryNo).toBeNull();
    expect(res.creditInEntryNo).not.toBeNull();

    // ใบลดหนี้ + ใบเดิม
    const cn = await prisma.receipt.findFirstOrThrow({ where: { contractId: c.id, receiptType: 'CREDIT_NOTE' } });
    expect(cn.cnSource).toBe(DEFECT_EXCHANGE_CN_SOURCE);
    expect(D(cn.amount.toString()).toFixed(2)).toBe('1515.83');
    expect(D(String(cn.vatAmount)).toFixed(2)).toBe('99.17');
    expect(D(String(cn.amountBeforeVat)).toFixed(2)).toBe('1416.66');
    const original = await prisma.receipt.findUniqueOrThrow({ where: { id: cn.voidedReceiptId! } });
    expect(original.isVoided).toBe(true);
    expect(original.voidReason).toContain(res.newContract.contractNumber);
    // งวด 1 ของสัญญาเดิมกลับเป็นค้าง
    const pay1 = await prisma.payment.findFirstOrThrow({ where: { contractId: c.id, installmentNo: 1 } });
    expect(pay1.status).toBe('PENDING');
    expect(D(pay1.amountPaid.toString()).toFixed(2)).toBe('0.00');

    // รายการ: กระจกรับชำระ redirect · กระจก 2A · กระจก 1A · ไม่มี credit-out · credit-in บนสัญญาใหม่
    const oldEntries = await entriesOf(c.id);
    const receiptMirror = oldEntries.find((e) => metaOf(e).flow === 'receipt-void');
    expect(receiptMirror && metaOf(receiptMirror).redirectedTo).toBe('21-1106');
    expect(sortedLines(receiptMirror!)).toEqual(['11-2103:1515.83:0.00', '21-1106:0.00:1515.83']);
    expect(oldEntries.some((e) => metaOf(e).flow === 'receipt-accrual-void')).toBe(true);
    expect(oldEntries.some((e) => metaOf(e).flow === 'defect-exchange' && metaOf(e).tag === 'REVERSAL')).toBe(true);
    expect(oldEntries.some((e) => metaOf(e).flow === 'defect-exchange-credit-out')).toBe(false);
    const newEntries = await entriesOf(res.newContract.id);
    const creditIn = newEntries.find((e) => metaOf(e).flow === 'defect-exchange-credit-in');
    expect(sortedLines(creditIn!)).toEqual(['21-1106:1515.83:0.00', '21-5101:0.00:1515.83']);
    expect(metaOf(creditIn!)).not.toHaveProperty(ADVANCE_VAT_META.park);

    // ยอดในบัญชี
    for (const code of ['11-2101', '11-2103', '11-2105', '11-2106', '21-2101', '21-2102', '41-1101', '21-1101', '21-1102', '21-1103', '21-5101']) {
      expect((await glContractBalance(prisma, c.id, code, 'cr')).toFixed(2), code).toBe('0.00');
    }
    expect((await glContractBalance(prisma, c.id, '21-1106', 'cr')).toFixed(2)).toBe('1515.83');
    expect((await accountNet('21-1106', 'cr')).toFixed(2)).toBe('0.00');
    expect((await accountNet('11-1201', 'dr')).toFixed(2)).toBe(bankBefore.toFixed(2));
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('1515.83');
    expect((await accountNet('21-2101', 'cr')).toFixed(2)).toBe('0.00');
    const newRow = await prisma.contract.findUniqueOrThrow({ where: { id: res.newContract.id } });
    expect(D(newRow.creditBalance.toString()).toFixed(2)).toBe('1515.83');
    expect(newRow.parentContractId).toBe(c.id);

    // เปิดใช้ + ใช้เครดิต (ทางเดียวกับ hook ตอน activate — Task 8)
    await activateNew(c.id, res.newContract.id);
    const applied = await orchestrator.applyCreditBalance(res.newContract.id, OWNER.id);
    expect(applied.creditUsed).toBe(1515.83);
    expect(applied.creditRemaining).toBe(0);
    const newPay1 = await prisma.payment.findFirstOrThrow({ where: { contractId: res.newContract.id, installmentNo: 1 } });
    expect(newPay1.status).toBe('PAID');
    const creditReceipt = await prisma.receipt.findFirstOrThrow({ where: { contractId: res.newContract.id, paymentMethod: 'CREDIT_BALANCE' } });
    expect(D(creditReceipt.amount.toString()).toFixed(2)).toBe('1515.83');
    expect(D(String(creditReceipt.vatAmount)).toFixed(2)).toBe('99.17');
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('0.00');
    expect((await accountNet('21-2101', 'cr')).toFixed(2)).toBe('99.17');
    expect((await advanceVatOutstanding(prisma, res.newContract.id)).toFixed(2)).toBe('0.00');
  });

  it('2) ไม่มีใบรับเงิน ไม่มีเงินค้าง: ไม่มีใบลดหนี้ ไม่มีรายการ ข/ง · creditBalance 0 (พฤติกรรมเดิม)', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    const est = await eligCredit(c.id, c.replacementId);
    const res = await exchange(c.id, c.replacementId);
    expect(est).toBe(res.transferredCredit); // กล่องยืนยัน === T ที่ลงจริง (I2)
    expect(res.transferredCredit).toBe('0.00');
    expect(res.creditNoteNumbers).toEqual([]);
    expect(await prisma.receipt.count({ where: { contractId: c.id } })).toBe(0);
    const newEntries = await entriesOf(res.newContract.id);
    expect(newEntries.some((e) => metaOf(e).flow === 'defect-exchange-credit-in')).toBe(false);
    expect((await accountNet('21-1106', 'cr')).toFixed(2)).toBe('0.00');
  });

  it('3) เคยปรับดิว (ถังพัก > 0) → BadRequest ก่อนเขียนอะไร', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    await prisma.contract.update({ where: { id: c.id }, data: { rescheduleAdvanceBalance: D('100') } });
    await expect(exchange(c.id, c.replacementId)).rejects.toThrow(EXCHANGE_BLOCK_RESCHEDULED);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('ACTIVE');
  });

  it('4) จ่ายหลังครบกำหนด (Review Focus 3): ก กลับ 2A ไม่ได้ → ค mirror 2A · T = 1,515.83 · ทุกบัญชีของสัญญาเดิม 0', async () => {
    // ครบกำหนดแล้ว 5 วัน ⇒ ค่าปรับขั้น 2 = 100 (ค่าเริ่มต้น 50/100/3) ⇒ ยอดที่ต้องชำระ 1,615.83 — จ่ายเต็ม
    const c = await seedContract({ dueDate: new Date(Date.now() - 5 * DAY_MS), paymentRows: [1, 2] });
    await record(c.id, 1, 1615.83, 'ref-late');
    const est = await eligCredit(c.id, c.replacementId);
    const res = await exchange(c.id, c.replacementId);
    expect(est).toBe(res.transferredCredit); // กล่องยืนยัน === T ที่ลงจริง (I2)
    // ใบลดหนี้/เครดิต = ยอดใบทั้งใบ (ค่าปรับ 100 ที่จ่ายแล้วกลับเป็นเงินของลูกค้า — กระจก Dr 42-1103)
    expect(res.transferredCredit).toBe('1615.83');
    const oldEntries = await entriesOf(c.id);
    expect(oldEntries.some((e) => metaOf(e).flow === 'receipt-accrual-void')).toBe(false);
    const mirrored2A = oldEntries.filter((e) => metaOf(e).flow === 'defect-exchange' && metaOf(e).tag === 'REVERSAL');
    expect(mirrored2A.length).toBeGreaterThanOrEqual(2); // 1A + 2A
    for (const code of ['11-2101', '11-2103', '11-2105', '11-2106', '21-2101', '21-2102', '41-1101', '42-1103']) {
      expect((await glContractBalance(prisma, c.id, code, 'cr')).toFixed(2), code).toBe('0.00');
    }
    expect((await accountNet('21-1106', 'cr')).toFixed(2)).toBe('0.00');
  });

  it('5) ใบรับบางส่วน 1,000 ก่อนครบกำหนด (Review Focus 4): ใบลดหนี้ 1,000 · 2A บางส่วนถูกกลับ · T = 1,000', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    await record(c.id, 1, 1000, 'ref-part', 'PARTIAL');
    const est = await eligCredit(c.id, c.replacementId);
    const res = await exchange(c.id, c.replacementId);
    expect(est).toBe(res.transferredCredit); // กล่องยืนยัน === T ที่ลงจริง (I2)
    expect(res.transferredCredit).toBe('1000.00');
    const cn = await prisma.receipt.findFirstOrThrow({ where: { contractId: c.id, receiptType: 'CREDIT_NOTE' } });
    expect(D(cn.amount.toString()).toFixed(2)).toBe('1000.00');
    expect(D(String(cn.vatAmount)).toFixed(2)).toBe('65.42');
    const oldEntries = await entriesOf(c.id);
    expect(oldEntries.some((e) => metaOf(e).flow === 'receipt-accrual-void')).toBe(true);
    expect((await glContractBalance(prisma, c.id, '11-2103', 'dr')).toFixed(2)).toBe('0.00');
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('1000.00');
  });

  it('6) เงินของลูกค้าค้างบนสัญญาเดิม (เครดิต 300 พักภาษี 19.63): ขั้น ข ย้าย + กลับภาษีทั้งก้อน · ธนาคารไม่ขยับ · T = 300', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    // จำลองจ่ายเกิน (overpayment-credit ของกระจายเงิน): Dr ธนาคาร / Cr 21-5101 + ขาพักภาษี (PR4 ต2 ง)
    await journal.createAndPost({
      description: 'test overpayment credit',
      reference: `test-over:${c.id}`,
      metadata: { tag: 'overpayment-credit', contractId: c.id, paymentId: 'none', [ADVANCE_VAT_META.park]: '19.63' },
      lines: [
        { accountCode: '11-1201', dr: D(300), cr: D(0) },
        { accountCode: '21-5101', dr: D(0), cr: D(300) },
        { accountCode: '21-2102', dr: D('19.63'), cr: D(0) },
        { accountCode: '21-2101', dr: D(0), cr: D('19.63') },
      ],
    });
    await prisma.contract.update({ where: { id: c.id }, data: { creditBalance: D(300) } });
    const bankBefore = await accountNet('11-1201', 'dr');
    const est = await eligCredit(c.id, c.replacementId);
    const res = await exchange(c.id, c.replacementId);
    expect(est).toBe(res.transferredCredit); // กล่องยืนยัน === T ที่ลงจริง (I2)
    expect(res.transferredCredit).toBe('300.00');
    const out = (await entriesOf(c.id)).find((e) => metaOf(e).flow === 'defect-exchange-credit-out');
    expect(sortedLines(out!)).toEqual(['21-1106:0.00:300.00', '21-2101:19.63:0.00', '21-2102:0.00:19.63', '21-5101:300.00:0.00']);
    expect(metaOf(out!)[ADVANCE_VAT_META.consume]).toBe('19.63');
    expect((await advanceVatOutstanding(prisma, c.id)).toFixed(2)).toBe('0.00');
    expect((await accountNet('11-1201', 'dr')).toFixed(2)).toBe(bankBefore.toFixed(2));
    const oldRow = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(D(oldRow.creditBalance.toString()).toFixed(2)).toBe('0.00');
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('300.00');
  });

  it('7) A→B→C (Review Focus 2): สัญญาใหม่ที่ใช้เครดิตแล้วถูกเปลี่ยนเครื่องอีกครั้ง → เครดิตย้ายต่อ 1,515.83 · 21-1106 สุทธิ 0', async () => {
    const a = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    const vatBefore = await accountNet('21-2101', 'cr'); // เทสก่อนหน้าทิ้งยอดสะสมไว้ (ledger ล้างเฉพาะ beforeAll/afterAll)
    await record(a.id, 1, 1515.83, 'ref-chain');
    const abEst = await eligCredit(a.id, a.replacementId);
    const ab = await exchange(a.id, a.replacementId);
    expect(abEst).toBe(ab.transferredCredit);
    await activateNew(a.id, ab.newContract.id);
    await orchestrator.applyCreditBalance(ab.newContract.id, OWNER.id);
    // เตรียม B ให้เปลี่ยนเครื่องได้อีกครั้ง
    const bProduct = await prisma.product.findUniqueOrThrow({ where: { id: a.replacementId } });
    const cProduct = await prisma.product.create({
      data: {
        name: 'Replacement Phone 2', brand: bProduct.brand, model: bProduct.model, storage: bProduct.storage, category: 'PHONE_USED',
        status: 'IN_STOCK', imeiSerial: `DXR2-${Date.now()}`, costPrice: D('8000'), cashPrice: D('12000'), installmentPrice: D('17000'),
        branchId: bProduct.branchId, ownedByCompanyId: bProduct.ownedByCompanyId,
      },
    });
    await prisma.contract.update({ where: { id: ab.newContract.id }, data: { deviceReceivedAt: new Date() } });
    await seedStatementReview(prisma, a.customerId);
    const bcEst = await eligCredit(ab.newContract.id, cProduct.id);
    vi.mocked(Sentry.captureMessage).mockClear();
    const bc = await exchange(ab.newContract.id, cProduct.id);
    expect(bc.transferredCredit).toBe('1515.83');
    expect(bcEst).toBe(bc.transferredCredit);
    // I1: ขั้น ข ต้องอ่านคอลัมน์สดหลังขั้น ก (void คืน creditBalance ให้ B) — ห้ามเตือน "คอลัมน์ไม่ตรงบัญชี" เท็จ
    expect(mismatchWarned()).toBe(false);
    expect(bc.creditNoteNumbers).toHaveLength(1); // ใบใช้เครดิตของ B ได้ใบลดหนี้
    expect((await glContractBalance(prisma, bc.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('1515.83');
    expect((await glContractBalance(prisma, ab.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('0.00');
    expect((await accountNet('21-1106', 'cr')).toFixed(2)).toBe('0.00');
    // ภาษีสุทธิไม่เปลี่ยน: +99.17 (ใบ A) −99.17 (กลับ 2A ของ A) +99.17 (ใช้เครดิต B) −99.17 (กลับ 2A ของ B)
    expect((await accountNet('21-2101', 'cr')).toFixed(2)).toBe(vatBefore.toFixed(2));
  });

  it('8) งวดเดียว 2 ใบ (บางส่วน 1,000 + ปิดงวด 515.83 — ใบพี่น้อง): ใบลดหนี้ 2 ใบ · T = 1,515.83 (ผู้ตรวจอิสระ C1 — partial unique cn_source)', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    await record(c.id, 1, 1000, 'ref-s8a', 'PARTIAL');
    await record(c.id, 1, 515.83, 'ref-s8b');
    const est = await eligCredit(c.id, c.replacementId);
    const res = await exchange(c.id, c.replacementId);
    expect(res.transferredCredit).toBe('1515.83');
    expect(est).toBe(res.transferredCredit);
    expect(res.creditNoteNumbers).toHaveLength(2);
    expect(res.voidedReceiptNumbers).toHaveLength(2);
    const cns = await prisma.receipt.findMany({ where: { contractId: c.id, receiptType: 'CREDIT_NOTE' } });
    expect(cns).toHaveLength(2);
    expect(cns.every((r) => r.cnSource === DEFECT_EXCHANGE_CN_SOURCE)).toBe(true);
    expect(cns.map((r) => D(r.amount.toString()).toFixed(2)).sort()).toEqual(['1000.00', '515.83']);
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('1515.83');
  });

  it('9) 2 งวด 2 ใบ: ใบลดหนี้ 2 ใบ · T = 3,031.66 (C1 — ใบลดหนี้ cn_source เดียวกันหลายใบต่อสัญญา)', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2, 3] });
    await record(c.id, 1, 1515.83, 'ref-s9a');
    await record(c.id, 2, 1515.83, 'ref-s9b');
    const est = await eligCredit(c.id, c.replacementId);
    const res = await exchange(c.id, c.replacementId);
    expect(res.transferredCredit).toBe('3031.66');
    expect(est).toBe(res.transferredCredit);
    expect(res.creditNoteNumbers).toHaveLength(2);
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('3031.66');
    expect((await accountNet('21-1106', 'cr')).toFixed(2)).toBe('0.00');
  });

  it('10) เงินรับล่วงหน้าที่รอบกลางคืนหักเข้างวดโดยไม่มีใบ (ผู้ตรวจอิสระ I2): กล่องยืนยัน = T = 2,015.83 — ไม่ใช่ Σ ใบ 1,515.83', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    await record(c.id, 1, 1515.83, 'ref-s10');
    // ส่วนเกินลิงก์ชำระ 500 พักเป็นเงินรับล่วงหน้า (เงินสด ↔ 21-1103 ล้วน — ขั้น ค ข้าม) แล้วรอบกลางคืนหักเข้างวด 2 โดยไม่มีใบเสร็จ
    await journal.createAndPost({
      description: '[ทดสอบ] ส่วนเกินลิงก์ชำระพักเป็นเงินรับล่วงหน้า',
      reference: `test-surplus:${c.id}`,
      metadata: { tag: 'receipt', flow: 'paysolutions-surplus-advance', idempotencyKey: `test-surplus:${c.id}`, contractId: c.id },
      lines: [
        { accountCode: '11-1201', dr: D('500'), cr: D('0'), description: 'เงินเข้า' },
        { accountCode: '21-1103', dr: D('0'), cr: D('500'), description: 'เงินรับล่วงหน้า' },
      ],
    });
    await journal.createAndPost({
      description: '[ทดสอบ] หักเงินรับล่วงหน้าเข้างวด 2 (รอบกลางคืน)',
      reference: `test-consume:${c.id}`,
      metadata: { tag: '2B', flow: 'advance-consume-on-accrual', idempotencyKey: `test-consume:${c.id}`, contractId: c.id },
      lines: [
        { accountCode: '21-1103', dr: D('500'), cr: D('0'), description: 'หักเงินรับล่วงหน้า' },
        { accountCode: '11-2103', dr: D('0'), cr: D('500'), description: 'ล้างลูกหนี้งวด' },
      ],
    });
    expect((await glContractBalance(prisma, c.id, '21-1103', 'cr')).toFixed(2)).toBe('0.00');
    const est = await eligCredit(c.id, c.replacementId);
    const res = await exchange(c.id, c.replacementId);
    expect(res.transferredCredit).toBe('2015.83');
    expect(est).toBe(res.transferredCredit);
    expect((await glContractBalance(prisma, c.id, '21-1103', 'cr')).toFixed(2)).toBe('0.00');
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('2015.83');
  });

  it('11) เปิดใช้ → hook ใช้เครดิตอัตโนมัติ (applyExchangeCreditAfterActivation กับ applier จริง · ไม่มี actor → admin) (ผู้ตรวจอิสระ I3)', async () => {
    const c = await seedContract({ dueDate: futureDue(), paymentRows: [1, 2] });
    await record(c.id, 1, 1515.83, 'ref-s11');
    const res = await exchange(c.id, c.replacementId);
    await activateNew(c.id, res.newContract.id);
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: res.newContract.id } });
    const applier = { applyCreditBalance: (id: string, by: string) => orchestrator.applyCreditBalance(id, by) };
    const out = await applyExchangeCreditAfterActivation({ prisma, payments: applier }, row, undefined);
    expect(out).toMatchObject({ applied: true, installments: 1, creditUsed: 1515.83, creditRemaining: 0, actorId: OWNER.id });
    const receipt = await prisma.receipt.findFirstOrThrow({ where: { contractId: res.newContract.id, paymentMethod: 'CREDIT_BALANCE' } });
    expect(receipt.issuedById).toBe(OWNER.id);
    expect((await glContractBalance(prisma, res.newContract.id, '21-5101', 'cr')).toFixed(2)).toBe('0.00');
    // เรียกซ้ำ = คอลัมน์เครดิต 0 → NO_CREDIT · ไม่มี PaymentsService → NO_PAYMENTS_SERVICE + Sentry
    const again = await prisma.contract.findUniqueOrThrow({ where: { id: res.newContract.id } });
    expect(await applyExchangeCreditAfterActivation({ prisma, payments: applier }, again, OWNER.id)).toEqual({ applied: false, reason: 'NO_CREDIT' });
    vi.mocked(Sentry.captureMessage).mockClear();
    expect(await applyExchangeCreditAfterActivation({ prisma, payments: null }, row, OWNER.id)).toEqual({ applied: false, reason: 'NO_PAYMENTS_SERVICE' });
    expect(JSON.stringify(vi.mocked(Sentry.captureMessage).mock.calls)).toContain('defect-exchange-credit-autoapply-failed');
  });
});
