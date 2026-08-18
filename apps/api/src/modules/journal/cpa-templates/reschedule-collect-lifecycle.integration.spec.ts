/**
 * P0 golden — ปรับดิว 6a collect-first → park-at-last-installment → final receipt.
 *
 * Runner: vitest (DB-backed; cpa-templates + *.integration.spec.ts are jest-ignored
 * per package.json testPathIgnorePatterns — same gating as
 * payment-receipt.waiver.integration.spec.ts).
 * Run:    cd apps/api && npx vitest run --no-file-parallelism \
 *           src/modules/journal/cpa-templates/reschedule-collect-lifecycle.integration.spec.ts
 *
 * REWRITTEN 2026-08-16 (owner directive — ค่าปรับดิวพักงวดสุดท้าย): the fee no
 * longer auto-consumes at the NEXT installment's 2A accrual (that was the bug
 * this directive fixes — "fee 857฿ ของ 6b งวด 6/12 ถูกหักเข้างวด 7/12"). It now
 * parks in the DEDICATED `Contract.rescheduleAdvanceBalance` bucket and is
 * relieved ONLY when the contract's actual LAST installment (#12 here) accrues.
 *
 * Lifecycle under test (owner directive 2026-07-02 "เงินไม่เข้า ดิวไม่เลื่อน" +
 * 2026-08-16 park-at-last-installment):
 *   1. Overdue installment #1 (due 2025-02-01, live late fee = flat tier2 100 —
 *      CPA ยืนยันขั้นบันไดถาวร 2026-08-01; any run date well past minDays=3
 *      lands on tier2 deterministically, same as the retired PER_DAY 5%-cap
 *      fixture this test used before).
 *   2. RescheduleCollectService.executeWithCollect 6a (SPLIT, 7 days):
 *        fee = 1,515.84/30×7 ROUND_UP = 354; collect = 354 + 100 = 454.00
 *        JE: Dr 11-1101 454.00 / Cr 21-1103 354.00 / Cr 42-1103 100.00
 *        + rescheduleAdvanceBalance +354 (NOT advanceBalance — separate park
 *        bucket) + lateFee reset 0 + dates +7d
 *        + AuditLog OVERPAY_ADVANCE_RECORDED (source RESCHEDULE_COLLECT_6A_FEE,
 *        bucket RESCHEDULE_PARK).
 *   3. 2A accrual on the shifted installment #1 (NOT the contract's last
 *      installment — totalMonths=12) does NOT touch the park bucket at all —
 *      no advance-consume JE, no reschedule-park-consume JE. The 354 stays
 *      parked untouched.
 *   4. Final receipt for installment #1 clears the FULL installmentTotal
 *      1,515.83 (not netted — installment #1 isn't the last installment).
 *   5. 2A accrual on installment #12 (the ACTUAL last installment) consumes
 *      the parked 354: Dr 21-1103 / Cr 11-2103 = 354, rescheduleAdvanceBalance
 *      → 0. This is the money finally being relieved, proving it isn't lost.
 *
 * Money-critical invariant (what reconstructPriorCleared guards):
 *   Σ(Cr 11-2103) for installment #1 across ALL JEs == 1,515.83 EXACTLY once
 *   (the accrual Dr 1,515.83 nets against ONE receipt Cr 1,515.83 — no advance
 *   consume in the mix this time), Σ(Cr 42-1103) == 100.00 exactly once (fee
 *   not re-billed at the receipt), and Contract.advanceBalance (the GENERIC
 *   bucket) never moves in this whole scenario — only rescheduleAdvanceBalance
 *   does, and only at installment #12.
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

/** Pin the late-fee config so the live quote is deterministic (flat-bracket defaults). */
const LATE_FEE_KEYS = [
  ['late_fee_tier1_amount', '50'],
  ['late_fee_tier2_amount', '100'],
  ['late_fee_tier2_min_days', '3'],
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
  const jeLine = (je: {
    lines: { accountCode: string; debit: DecimalLike; credit: DecimalLike }[];
  }) => ({
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
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
      select: { contractId: true },
    });
    await prisma.contract.deleteMany({
      where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
    });

    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    await ensureSystemAdminUser();
    for (const [key, value] of LATE_FEE_KEYS) {
      await prisma.systemConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
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
    // 2025-02-01 (seed), so any run date well past minDays=3 lands on flat
    // tier2 = 100 (deterministic, CPA ยืนยันขั้นบันไดถาวร). lateFee 200 below
    // is a deliberately-wrong decoy stamp (from a stale overdue-cron run) to
    // prove the reschedule quote LIVE-recomputes rather than trusting it.
    const payment = await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: 1,
        dueDate: sched1.dueDate,
        amountDue: D('1515.84'), // contract.monthlyPayment (incl. commission + VAT)
        status: 'OVERDUE',
        lateFee: D('200.00'),
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
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
      select: { contractId: true },
    });
    await prisma.contract.deleteMany({
      where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
    });
    await prisma.systemConfig.deleteMany({
      where: { key: { in: LATE_FEE_KEYS.map(([key]) => key) } },
    });
    // NOTE: $disconnect() moved to the LAST suite's afterAll in this file — the
    // C-1 suite below shares this PrismaClient and runs after this one.
  });

  it('6a executeWithCollect: Dr 11-1101 454.00 / Cr 21-1103 354 / Cr 42-1103 100.00, advance +354, lateFee reset, dates +7d, audit written', async () => {
    const result = await service.executeWithCollect({
      contractId: c.id,
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SPLIT',
      amount: 454.0, // fee 354 (1,515.84/30×7 ROUND_UP) + late fee 100 (flat tier2)
      paymentMethod: 'CASH',
      recordedById,
    });

    expect(result.variant).toBe('6a');
    expect(result.rescheduleFee).toBe('354.00');
    expect(result.lateFeeCollected).toBe('100.00');
    expect(result.collectAmount).toBe('454.00');
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
    expect(dr('11-1101')).toBe('454.00'); // user default cash account
    expect(cr('21-1103')).toBe('354.00');
    expect(cr('42-1103')).toBe('100.00');
    const totalDr = je!.lines.reduce(
      (s, l) => s.plus(new Decimal(l.debit.toString())),
      new Decimal(0),
    );
    const totalCr = je!.lines.reduce(
      (s, l) => s.plus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    expect(totalDr.toFixed(2)).toBe('454.00');
    expect(totalCr.toFixed(2)).toBe('454.00');

    // 6a fee = PREPAYMENT, park-at-last-installment (2026-08-16): the fee lands
    // on the DEDICATED park bucket — Contract.advanceBalance (generic) is
    // NEVER touched by this reschedule at all.
    const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(new Decimal(contractAfter.rescheduleAdvanceBalance.toString()).toFixed(2)).toBe(
      '354.00',
    );
    expect(new Decimal(contractAfter.advanceBalance.toString()).toFixed(2)).toBe('0.00');

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
    expect(nv.afterBalance).toBe('354'); // afterBalance of the PARK bucket now, not generic
    expect(nv.bucket).toBe('RESCHEDULE_PARK');

    // Money-detail audit row + post-commit e-Receipt for the collected cash.
    const collectAudit = await prisma.auditLog.findFirst({
      where: { action: 'RESCHEDULE_COLLECT', entity: 'payment', entityId: paymentId },
    });
    expect(collectAudit).not.toBeNull();
    const receipt = await prisma.receipt.findFirst({
      where: { contractId: c.id, receiptType: 'RESCHEDULE_FEE', deletedAt: null },
    });
    expect(receipt, 'expected RESCHEDULE_FEE e-Receipt').not.toBeNull();
    expect(new Decimal(receipt!.amount.toString()).toFixed(2)).toBe('454.00');
  });

  it('2A accrual on the shifted installment #1 (NOT the last installment) does NOT touch the park bucket at all', async () => {
    const journal = new JournalAutoService(prisma as any);
    const accrued = await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(
      sched1Id,
    );
    expect(accrued).not.toBeNull();

    // Accrual JE — full installmentTotal receivable, unaffected by the park change.
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

    // Park-at-last-installment (2026-08-16): installment #1 is NOT the
    // contract's last installment (totalMonths=12) — neither the generic
    // advance-consume JE NOR a reschedule-park-consume JE should post here.
    // This is the exact class of bug the directive fixes: the fee must NOT
    // auto-relieve into whichever installment accrues next.
    const consumeJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'advance-consume-on-accrual' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: sched1Id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(consumeJe, 'no generic advance-consume JE expected (generic bucket is 0)').toBeNull();
    const parkConsumeJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'reschedule-park-consume' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: sched1Id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(
      parkConsumeJe,
      'no park-consume JE expected — installment #1 is not the last installment',
    ).toBeNull();

    // Park bucket untouched — still 354.00. Generic advance still 0.
    const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(new Decimal(contractAfter.rescheduleAdvanceBalance.toString()).toFixed(2)).toBe(
      '354.00',
    );
    expect(new Decimal(contractAfter.advanceBalance.toString()).toFixed(2)).toBe('0.00');

    // Payment row completely untouched by 2A (no advance/park to consume into it).
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(new Decimal(pay.amountPaid.toString()).toFixed(2)).toBe('0.00');
  });

  it('final receipt for installment #1 clears the FULL installmentTotal 1,515.83 — NOT netted (installment #1 is not the last installment)', async () => {
    const journal = new JournalAutoService(prisma as any);
    const tpl = new PaymentReceiptTemplate(journal, prisma as any);

    // Nothing pre-cleared this installment (no advance/park consume happened
    // in the previous test) — the final receipt clears the full 1,515.83 in
    // one go, exactly as an ordinary receipt on an un-touched installment would.
    const { split } = await tpl.execute({
      installmentScheduleId: sched1Id,
      delta: D('1515.83'),
      debitAccountCode: '11-1201',
      isFinalReceipt: true,
      paymentId,
    });
    expect(split.principalCleared.toFixed(2)).toBe('1515.83');
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
    expect(dr('11-1201')).toBe('1515.83');
    expect(cr('11-2103')).toBe('1515.83');
    // The 100.00 late fee was already booked at reschedule-collect — never again here.
    expect(receiptJe!.lines.find((l) => l.accountCode === '42-1103')).toBeUndefined();

    // ── Money-critical invariant ────────────────────────────────────────────
    // Across ALL JEs of installment #1: 11-2103 credited installmentTotal
    // exactly ONCE (this single receipt, since no advance/park consume ever
    // touched this installment) and fully cleared.
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
    expect(lateFeeCr.toFixed(2)).toBe('100.00');

    // Both buckets still exactly as before this receipt — a receipt on a
    // non-last installment must never touch either advance bucket.
    const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(new Decimal(contractAfter.advanceBalance.toString()).toFixed(2)).toBe('0.00');
    expect(new Decimal(contractAfter.rescheduleAdvanceBalance.toString()).toFixed(2)).toBe(
      '354.00',
    );
  });

  it('2A accrual on installment #12 (the ACTUAL last installment) finally consumes the parked 354 — proves the money is not lost', async () => {
    const journal = new JournalAutoService(prisma as any);
    const sched12 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 12 } },
    });

    const accrued = await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(
      sched12.id,
    );
    expect(accrued).not.toBeNull();

    const parkConsumeJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'reschedule-park-consume' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: sched12.id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(
      parkConsumeJe,
      'expected a reschedule-park-consume JE on the LAST installment',
    ).not.toBeNull();
    const { dr, cr } = jeLine(parkConsumeJe!);
    expect(dr('21-1103')).toBe('354.00');
    expect(cr('11-2103')).toBe('354.00');
    expect(parkConsumeJe!.lines.find((l) => l.accountCode === '21-1103')!.description).toBe(
      'หักเงินพักปรับดิวเข้างวดสุดท้าย',
    );

    // Park bucket fully drained; generic advance still untouched throughout
    // this entire scenario (it was never the mechanism in play).
    const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(new Decimal(contractAfter.rescheduleAdvanceBalance.toString()).toFixed(2)).toBe('0.00');
    expect(new Decimal(contractAfter.advanceBalance.toString()).toFixed(2)).toBe('0.00');
  });

  /**
   * I-1 (final review 2026-08-16) — RESTORED coverage.
   *
   * The pre-rewrite test 3 asserted that `reconstructPriorCleared` counts the
   * 354 advance-consume so the following receipt clears only the REMAINDER.
   * The rewrite moved the receipt to an installment that has NO consume, which
   * made the "Σ(Cr 11-2103) exactly once" invariant vacuous — and left the
   * park-consume-then-receipt interaction (the one C-1 breaks) untested.
   *
   * This is that interaction on the LAST installment (partial park coverage:
   * park 354 < installmentTotal). The FULL-coverage variant — where the park
   * consume equals installmentTotal, which is what C-1 actually breaks — is the
   * dedicated suite at the bottom of this file.
   */
  it('receipt on installment #12 AFTER the park consume clears only the remainder — Σ(Cr 11-2103) counted exactly once', async () => {
    const journal = new JournalAutoService(prisma as any);
    const tpl = new PaymentReceiptTemplate(journal, prisma as any);
    const sched12 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c.id, installmentNo: 12 } },
    });

    // The receipt primitive's basis is the UN-residual-adjusted installmentTotal
    // (1,515.83) — the 2A accrual's last-period residual adjustment (1,515.87)
    // is a pre-existing, unrelated 4-satang asymmetry between the two bases.
    // 1,515.83 − 354 (already cleared by the park consume) = 1,161.83.
    const { split } = await tpl.execute({
      installmentScheduleId: sched12.id,
      delta: D('1161.83'),
      debitAccountCode: '11-1201',
      isFinalReceipt: true,
    });
    expect(split.principalCleared.toFixed(2)).toBe('1161.83');
    expect(split.principalRemainingAfter.toFixed(2)).toBe('0.00');

    // Σ over EVERY JE stamped with installment #12: the park consume's 354 and
    // this receipt's 1,161.83 — together exactly ONE installmentTotal, never two.
    const instEntries = await prisma.journalEntry.findMany({
      where: {
        metadata: { path: ['installmentScheduleId'], equals: sched12.id } as any,
        deletedAt: null,
      },
      include: { lines: true },
    });
    const cr11 = instEntries
      .flatMap((e) => e.lines)
      .filter((l) => l.accountCode === '11-2103')
      .reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    expect(cr11.toFixed(2)).toBe('1515.83');
    // Explicitly NOT the double-credit shape (354 + a full 1,515.83).
    expect(cr11.toFixed(2)).not.toBe('1869.83');
  });
});

/**
 * C-1 regression (final review 2026-08-16) — the park-consume JE must be
 * visible to `reconstructPriorCleared` even when it FULLY covers the
 * installment.
 *
 * `InstallmentAccrual2ATemplate` stamps the park relief with `tag:'2B'`, so
 * `reconstructPriorCleared` SELECTS it — but its discriminator only ever
 * special-cased `flow === 'advance-consume-on-accrual'`. Everything else fell
 * through to the legacy full-clear rule (`if (!entryCr11.lt(installmentTotal))
 * continue;`), which DROPS an entry that cleared the whole installment. A later
 * receipt on that installment then re-cleared the full amount →
 * Σ(Cr 11-2103) = 2 × installmentTotal. This is verbatim the failure the file's
 * own doc comment calls "FINAL-REVIEW BLOCKER 1".
 *
 * A full park consume is the FEATURE'S HEADLINE CASE, not an edge case: a
 * contract rescheduled several times routinely parks more than one
 * installment's worth (`min(park, installmentTotal)` then equals
 * installmentTotal exactly).
 *
 * Separate suite (own contract + own wipe) because the lifecycle suite above
 * drains its park bucket to 0 by design.
 */
describe('park consume == installmentTotal → a later receipt must NOT double-credit 11-2103 (C-1)', () => {
  let c2: StandardContract;
  let sched12Id: string;
  let accruedInstallmentTotal: Decimal;

  const sumFor = async (code: string, side: 'debit' | 'credit'): Promise<Decimal> => {
    const entries = await prisma.journalEntry.findMany({
      where: {
        metadata: { path: ['installmentScheduleId'], equals: sched12Id } as any,
        deletedAt: null,
      },
      include: { lines: true },
    });
    return entries
      .flatMap((e) => e.lines)
      .filter((l) => l.accountCode === code)
      .reduce((s, l) => s.plus(new Decimal(l[side].toString())), new Decimal(0));
  };

  beforeAll(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
      select: { contractId: true },
    });
    await prisma.contract.deleteMany({
      where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
    });

    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    await ensureSystemAdminUser();

    const journal = new JournalAutoService(prisma as any);
    c2 = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c2.id);

    // Multi-reschedule contract: 2,500 parked — more than the last
    // installment's total, so the 2A relief caps at installmentTotal exactly.
    await prisma.contract.update({
      where: { id: c2.id },
      data: { rescheduleAdvanceBalance: '2500.00' },
    });

    const sched12 = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { contractId_installmentNo: { contractId: c2.id, installmentNo: 12 } },
    });
    sched12Id = sched12.id;

    // Payment row with a large placeholder amountDue so the I-3 outstanding cap
    // does not bind here — this suite is about the FULL-coverage park consume.
    await prisma.payment.create({
      data: {
        contractId: c2.id,
        installmentNo: 12,
        dueDate: sched12.dueDate,
        amountDue: '99999.99',
        amountPaid: '0',
        status: 'PENDING',
      },
    });

    await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(sched12Id);

    // Residual-adjusted installmentTotal read off the 2A JE itself (kept in ONE
    // place — the template — rather than hardcoded here).
    const accrualJe = await prisma.journalEntry.findFirstOrThrow({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: '2A' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: sched12Id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    accruedInstallmentTotal = new Decimal(
      accrualJe.lines.find((l) => l.accountCode === '11-2103')!.debit.toString(),
    );
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
      select: { contractId: true },
    });
    await prisma.contract.deleteMany({
      where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
    });
    await prisma.$disconnect();
  });

  it('the park consume fully covers the last installment (consume == installmentTotal)', async () => {
    const parkJe = await prisma.journalEntry.findFirstOrThrow({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'reschedule-park-consume' } } as any,
          { metadata: { path: ['installmentScheduleId'], equals: sched12Id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    const parkConsume = new Decimal(
      parkJe.lines.find((l) => l.accountCode === '21-1103')!.debit.toString(),
    );
    expect(parkConsume.toFixed(2)).toBe(accruedInstallmentTotal.toFixed(2));

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c2.id } });
    expect(new Decimal(after.rescheduleAdvanceBalance.toString()).toFixed(2)).toBe(
      new Decimal('2500').minus(parkConsume).toFixed(2),
    );
  });

  it('a subsequent full receipt on that SAME installment is refused — Σ(Cr 11-2103) stays at exactly one installmentTotal', async () => {
    const journal = new JournalAutoService(prisma as any);
    const tpl = new PaymentReceiptTemplate(journal, prisma as any);

    const crBefore = await sumFor('11-2103', 'credit');
    expect(crBefore.toFixed(2)).toBe(accruedInstallmentTotal.toFixed(2));

    // Staff records a "full payment" on an installment the park bucket already
    // settled. With the park flow registered in reconstructPriorCleared's
    // always-include allow-list, priorPrincipalCleared == installmentTotal →
    // principalRemaining == 0 → the whole delta becomes overpayRounding, which
    // breaches the 1฿ tolerance and the primitive REFUSES to post.
    // Without the fix the JE posts and credits 11-2103 a SECOND time.
    let posted = false;
    let thrown: unknown = null;
    try {
      await tpl.execute({
        installmentScheduleId: sched12Id,
        delta: D('1515.83'),
        debitAccountCode: '11-1201',
        isFinalReceipt: true,
      });
      posted = true;
    } catch (err) {
      thrown = err;
    }

    const crAfter = await sumFor('11-2103', 'credit');
    const drAfter = await sumFor('11-2103', 'debit');

    // The money invariant is the assertion that matters: one accrual Dr, one
    // relief Cr — never a second Cr for the same installment.
    expect(
      crAfter.toFixed(2),
      'Σ(Cr 11-2103) must stay at exactly ONE installmentTotal — a second credit means the park consume was invisible to reconstructPriorCleared (C-1)',
    ).toBe(accruedInstallmentTotal.toFixed(2));
    expect(crAfter.toFixed(2)).toBe(drAfter.toFixed(2)); // receivable nets to 0, not negative
    expect(posted, 'the receipt must be refused, not posted').toBe(false);
    expect(thrown).toBeTruthy();
  });
});
