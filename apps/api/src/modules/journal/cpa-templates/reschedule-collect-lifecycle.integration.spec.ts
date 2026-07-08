/**
 * P0 golden — ปรับดิว 6a collect-first → 2A accrual auto-consume → final receipt.
 *
 * Runner: vitest (DB-backed; cpa-templates + *.integration.spec.ts are jest-ignored
 * per package.json testPathIgnorePatterns — same gating as
 * payment-receipt.waiver.integration.spec.ts).
 * Run:    cd apps/api && npx vitest run --no-file-parallelism \
 *           src/modules/journal/cpa-templates/reschedule-collect-lifecycle.integration.spec.ts
 *
 * Lifecycle under test (owner directive 2026-07-02 "เงินไม่เข้า ดิวไม่เลื่อน"):
 *   1. Overdue installment #1 (due 2025-02-01, live late fee capped 5% = 75.79).
 *   2. RescheduleCollectService.executeWithCollect 6a (SPLIT, 7 days):
 *        fee = 1,515.84/30×7 ROUND_UP = 354; collect = 354 + 75.79 = 429.79
 *        JE: Dr 11-1101 429.79 / Cr 21-1103 354.00 / Cr 42-1103 75.79
 *        + advanceBalance +354 + lateFee reset 0 + dates +7d
 *        + AuditLog OVERPAY_ADVANCE_RECORDED (source RESCHEDULE_COLLECT_6A_FEE).
 *   3. 2A accrual auto-consumes the 354 advance: Dr 21-1103 / Cr 11-2103 = 354.
 *   4. Final receipt for the remainder 1,161.83 (= 1,515.83 − 354).
 *
 * Money-critical invariant (what reconstructPriorCleared guards):
 *   Σ(Cr 11-2103) for the installment across ALL JEs == 1,515.83 EXACTLY once
 *   (354.00 advance-consume + 1,161.83 receipt — no double principal credit),
 *   Σ(Cr 42-1103) == 75.79 exactly once (fee not re-billed at the receipt),
 *   and Contract.advanceBalance is drawn down 354 → 0 by the consume.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m, StandardContract } from '../__tests__/scenario-helpers';
import { JournalAutoService } from '../journal-auto.service';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { PaymentReceiptTemplate } from './payment-receipt.template';
import { ReceiptVoidReversalTemplate } from './receipt-void-reversal.template';
import { RescheduleCollectService } from '../../payments/services/reschedule-collect.service';
import { RescheduleService } from '../../installments/reschedule.service';
import { ReceiptsService } from '../../receipts/receipts.service';

const prisma = new PrismaClient();
const D = (n: string) => new Decimal(n);

/** Pin the late-fee config so the live quote is deterministic (PER_DAY defaults). */
const LATE_FEE_KEYS = [
  ['late_fee_mode', 'PER_DAY'],
  ['late_fee_per_day_rate', '20'],
  ['late_fee_max_amount', '500'],
  ['late_fee_cap_pct', '5'],
] as const;

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000002',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: new Decimal('0.0700'),
      },
    });
  }
}

/** JournalAutoService.resolveSystemUserId requires admin@bestchoice.com. */
async function ensureSystemAdminUser(): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: 'admin@bestchoice.com',
        password: 'hashed_placeholder',
        name: 'System Admin',
        role: 'OWNER',
      },
    });
  }
}

describe('reschedule-collect 6a → 2A accrual → advance consume lifecycle (integration)', () => {
  let c: StandardContract;
  let sched1Id: string;
  let paymentId: string;
  let recordedById: string;
  let originalDue1: Date;
  let originalDue12: Date;
  let service: RescheduleCollectService;

  type DecimalLike = { toString(): string };
  const jeLine = (je: { lines: { accountCode: string; debit: DecimalLike; credit: DecimalLike }[] }) => ({
    dr: (code: string) =>
      new Decimal(je.lines.find((l) => l.accountCode === code)!.debit.toString()).toFixed(2),
    cr: (code: string) =>
      new Decimal(je.lines.find((l) => l.accountCode === code)!.credit.toString()).toFixed(2),
  });

  beforeAll(async () => {
    // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
    // them first or this deleteMany trips P2003 when an asset spec ran earlier.
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});

    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    await ensureSystemAdminUser();
    for (const [key, value] of LATE_FEE_KEYS) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }

    const journal = new JournalAutoService(prisma as any);
    c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const sched1 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 1 } },
    });
    const sched12 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 12 } },
    });
    sched1Id = sched1.id;
    originalDue1 = sched1.dueDate;
    originalDue12 = sched12.dueDate;

    recordedById = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'test-salesperson@bestchoice-test.internal' },
      })
    ).id;

    // Overdue Payment row for installment #1 — Payment IS the installment. Due
    // 2025-02-01 (seed), so any run date ≥ 25 days later caps the per-day fee at
    // 5% × 1,515.84 = 75.79 (deterministic). lateFee 75.79 = overdue-cron stamp.
    const payment = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: 1,
        dueDate: sched1.dueDate,
        amountDue: D('1515.84'), // contract.monthlyPayment (incl. commission + VAT)
        status: 'OVERDUE',
        lateFee: D('75.79'),
      },
    });
    paymentId = payment.id;

    service = new RescheduleCollectService(
      prisma as any,
      journal,
      new RescheduleService(prisma as any),
      new ReceiptsService(
        prisma as any,
        journal,
        new ReceiptVoidReversalTemplate(journal, prisma as any),
        undefined,
      ),
    );
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.systemConfig.deleteMany({
      where: { key: { in: LATE_FEE_KEYS.map(([key]) => key) } },
    });
    await prisma.$disconnect();
  });

  it('6a executeWithCollect: Dr 11-1101 429.79 / Cr 21-1103 354 / Cr 42-1103 75.79, advance +354, lateFee reset, dates +7d, audit written', async () => {
    const result = await service.executeWithCollect({
      contractId: c.id,
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SPLIT',
      amount: 429.79, // fee 354 (1,515.84/30×7 ROUND_UP) + late fee 75.79
      paymentMethod: 'CASH',
      recordedById,
    });

    expect(result.variant).toBe('6a');
    expect(result.rescheduleFee).toBe('354.00');
    expect(result.lateFeeCollected).toBe('75.79');
    expect(result.collectAmount).toBe('429.79');
    expect(result.shiftedInstallmentCount).toBe(12);

    // Collect JE — fee to 21-1103 advance, late fee to 42-1103 income, balanced.
    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'reschedule-collect' } } as any,
          { metadata: { path: ['contractId'], equals: c.id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(je, 'expected a reschedule-collect JE').not.toBeNull();
    expect(je!.entryNumber).toBe(result.journalEntryNo);
    const { dr, cr } = jeLine(je!);
    expect(dr('11-1101')).toBe('429.79'); // user default cash account
    expect(cr('21-1103')).toBe('354.00');
    expect(cr('42-1103')).toBe('75.79');
    const totalDr = je!.lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe('429.79');
    expect(totalCr.toFixed(2)).toBe('429.79');

    // 6a fee = PREPAYMENT — Contract.advanceBalance incremented by the fee.
    const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(new Decimal(contractAfter.advanceBalance.toString()).toFixed(2)).toBe('354.00');

    // Payment.lateFee reset to 0 (collected) + collected note; dueDate shifted +7d.
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(new Decimal(pay.lateFee.toString()).toFixed(2)).toBe('0.00');
    expect(pay.notes).toContain('เก็บแล้วตอนปรับดิว');
    const expectedDue1 = new Date(originalDue1);
    expectedDue1.setDate(expectedDue1.getDate() + 7);
    expect(pay.dueDate.getTime()).toBe(expectedDue1.getTime());

    // ALL schedules from #1 shifted by daysToShift (check first + last).
    const s1 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 1 } },
    });
    expect(s1.dueDate.getTime()).toBe(expectedDue1.getTime());
    expect(s1.rescheduledFromDate?.getTime()).toBe(originalDue1.getTime());
    expect(s1.rescheduleCount).toBe(1);
    const expectedDue12 = new Date(originalDue12);
    expectedDue12.setDate(expectedDue12.getDate() + 7);
    const s12 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 12 } },
    });
    expect(s12.dueDate.getTime()).toBe(expectedDue12.getTime());

    // Forensic advance trail — same shape the orchestrator writes.
    const advAudit = await prisma.auditLog.findFirst({
      where: { action: 'OVERPAY_ADVANCE_RECORDED', entity: 'contract', entityId: c.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(advAudit, 'expected OVERPAY_ADVANCE_RECORDED audit').not.toBeNull();
    const nv = advAudit!.newValue as Record<string, unknown>;
    expect(nv.advanceCredit).toBe('354');
    expect(nv.source).toBe('RESCHEDULE_COLLECT_6A_FEE');
    expect(nv.afterBalance).toBe('354');

    // Money-detail audit row + post-commit e-Receipt for the collected cash.
    const collectAudit = await prisma.auditLog.findFirst({
      where: { action: 'RESCHEDULE_COLLECT', entity: 'payment', entityId: paymentId },
    });
    expect(collectAudit).not.toBeNull();
    const receipt = await prisma.receipt.findFirst({
      where: { contractId: c.id, receiptType: 'RESCHEDULE_FEE', deletedAt: null },
    });
    expect(receipt, 'expected RESCHEDULE_FEE e-Receipt').not.toBeNull();
    expect(new Decimal(receipt!.amount.toString()).toFixed(2)).toBe('429.79');
  });

  it('2A accrual on the shifted due date auto-consumes the 354 advance (Dr 21-1103 / Cr 11-2103)', async () => {
    const journal = new JournalAutoService(prisma as any);
    const accrued = await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(sched1Id);
    expect(accrued).not.toBeNull();

    // Accrual JE — full installmentTotal receivable.
    const accrualJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: '2A' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: sched1Id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(accrualJe, 'expected a 2A accrual JE').not.toBeNull();
    expect(jeLine(accrualJe!).dr('11-2103')).toBe('1515.83');

    // Advance-consume JE (CPA Policy A) posted in the same accrual tx.
    const consumeJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'advance-consume-on-accrual' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: sched1Id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(consumeJe, 'expected an advance-consume JE').not.toBeNull();
    const { dr, cr } = jeLine(consumeJe!);
    expect(dr('21-1103')).toBe('354.00');
    expect(cr('11-2103')).toBe('354.00');

    // advanceBalance drawn down by the consumed amount: 354 → 0.
    const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(new Decimal(contractAfter.advanceBalance.toString()).toFixed(2)).toBe('0.00');

    // Payment row reflects the consume (partial cover).
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(new Decimal(pay.amountPaid.toString()).toFixed(2)).toBe('354.00');
    expect(pay.status).toBe('PARTIALLY_PAID');
  });

  it('final receipt clears ONLY the remainder — Σ(Cr 11-2103) == 1,515.83 exactly once, Σ(Cr 42-1103) == 75.79 exactly once', async () => {
    const journal = new JournalAutoService(prisma as any);
    const tpl = new PaymentReceiptTemplate(journal, prisma as any);

    // reconstructPriorCleared must count the 354 advance-consume (tag 2B,
    // flow advance-consume-on-accrual) and IGNORE the reschedule-collect JE
    // (tag intentionally NOT 'receipt') — so the final receipt clears exactly
    // 1,515.83 − 354 = 1,161.83. Were the consume invisible, isFinalReceipt
    // would reject (residual 354 > 1฿) — and counting the collect JE would
    // under-clear. Either failure mode breaks this test.
    const { split } = await tpl.execute({
      installmentScheduleId: sched1Id,
      delta: D('1161.83'),
      debitAccountCode: '11-1201',
      isFinalReceipt: true,
      paymentId,
    });
    expect(split.principalCleared.toFixed(2)).toBe('1161.83');
    expect(split.principalRemainingAfter.toFixed(2)).toBe('0.00');

    const receiptJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: sched1Id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(receiptJe, 'expected a receipt JE').not.toBeNull();
    const { dr, cr } = jeLine(receiptJe!);
    expect(dr('11-1201')).toBe('1161.83');
    expect(cr('11-2103')).toBe('1161.83');
    // The 75.79 late fee was already booked at reschedule-collect — never again here.
    expect(receiptJe!.lines.find((l) => l.accountCode === '42-1103')).toBeUndefined();

    // ── Money-critical invariant ────────────────────────────────────────────
    // Across ALL JEs of this installment: 11-2103 credited installmentTotal
    // exactly ONCE (354.00 consume + 1,161.83 receipt) and fully cleared.
    const instEntries = await prisma.journalEntry.findMany({
      where: {
        metadata: { path: ['installmentScheduleId'], equals: sched1Id } as any,
        deletedAt: null,
      },
      include: { lines: true },
    });
    const sum = (code: string, side: 'debit' | 'credit') =>
      instEntries
        .flatMap((e) => e.lines)
        .filter((l) => l.accountCode === code)
        .reduce((s, l) => s.plus(new Decimal(l[side].toString())), new Decimal(0));
    expect(sum('11-2103', 'credit').toFixed(2)).toBe('1515.83');
    expect(sum('11-2103', 'debit').toFixed(2)).toBe('1515.83'); // accrual Dr — net 0

    // Late fee income booked exactly once for the whole contract (the collect JE).
    const contractEntries = await prisma.journalEntry.findMany({
      where: {
        metadata: { path: ['contractId'], equals: c.id } as any,
        deletedAt: null,
      },
      include: { lines: true },
    });
    const lateFeeCr = contractEntries
      .flatMap((e) => e.lines)
      .filter((l) => l.accountCode === '42-1103')
      .reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    expect(lateFeeCr.toFixed(2)).toBe('75.79');

    // advanceBalance stays fully drawn down after the receipt.
    const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(new Decimal(contractAfter.advanceBalance.toString()).toFixed(2)).toBe('0.00');
  });
});
