/**
 * RescheduleCollectService — ปรับดิว collect-first (owner directive 2026-07-02).
 *
 * Locks the money semantics of "เงินไม่เข้า ดิวไม่เลื่อน" (owner correction
 * 2026-07-09 — CPA ตารางก่อน/หลังปรับดิว):
 *   - 6a (แบ่ง 2 ครั้ง): collect JE = Dr deposit (fee+ค่าปรับ) / Cr 21-1103 fee /
 *     Cr 42-1103 ค่าปรับ — this installment shifts and is paid at the new due
 *   - 6b (จ่ายทั้งก้อนวันนี้): controller books installment + fee + late fee via
 *     the orchestrator FIRST, then calls here with bundledPaid → phase 2 shifts
 *     from installmentNo+1 only, no money moves; direct 6b calls are rejected
 *   - Payment.lateFee resets to 0 AFTER collecting (new overdue period starts clean)
 *   - amount mismatch vs the server quote → BadRequest, nothing posted
 *   - โอน requires ref/slip; QR-webhook path (fixedQuote) books the frozen quote
 *   - reschedule + JE + audit share ONE $transaction; e-Receipt fires post-commit
 *
 * Hand-mocked Prisma ($transaction(cb) → cb(tx), tx === root) mirroring the
 * orchestrator spec pattern. Late-fee config keys resolve to null → flat-bracket
 * BUSINESS_RULES defaults (tier1=50, tier2=100, minDays=3) — the 5-day-overdue
 * fixture below lands on tier2 (>=3 days), giving lateFee=100.
 */
jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { RescheduleCollectService } from './reschedule-collect.service';

const D = (v: string | number) => new Prisma.Decimal(v);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

describe('RescheduleCollectService (ปรับดิว collect-first)', () => {
  let prisma: AnyObj;
  let journalAuto: AnyObj;
  let rescheduleService: AnyObj;
  let receiptsService: AnyObj;
  let service: RescheduleCollectService;

  // Mockup TEST-20260630-003: monthly 4,472; overdue 5 days → lateFee 100 (flat tier2, >=3 days).
  const NOW = new Date('2026-07-02T05:00:00Z');
  const DUE_5D_AGO = new Date('2026-06-27T05:00:00Z');

  const contractRow = {
    id: 'ct-1',
    contractNumber: 'TEST-20260630-003',
    status: 'OVERDUE',
    deletedAt: null,
    monthlyPayment: D('4472.00'),
  };
  const paymentRow = {
    id: 'pay-1',
    contractId: 'ct-1',
    installmentNo: 1,
    status: 'OVERDUE',
    deletedAt: null,
    dueDate: DUE_5D_AGO,
    amountDue: D('4472.00'),
    amountPaid: D('0.00'),
    lateFee: D('100.00'),
    lateFeeWaived: false,
    notes: null,
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });

    prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(contractRow),
        update: jest.fn().mockResolvedValue({}),
        // 6b bundledPaid sweep (park-at-last-installment, 2026-08-16) re-reads
        // the fresh generic/park balances inside the tx. Default both to 0 —
        // tests that need a nonzero generic balance to sweep override this.
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          advanceBalance: D('0'),
          rescheduleAdvanceBalance: D('0'),
        }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(paymentRow),
        update: jest.fn().mockResolvedValue({}),
      },
      installmentSchedule: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sched-1' }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'al-1' }),
        // M-3 idempotency probe: null = "this payment's fee has not been parked
        // yet". Retry tests override it with an existing RESCHEDULE_ADVANCE_PARKED row.
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // Late-fee + period-lock config keys → null (defaults / open period).
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }) },
      accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ defaultCashAccountCode: '11-1101' }) },
      $transaction: jest.fn((cb: (tx: AnyObj) => unknown) => cb(prisma)),
    };
    journalAuto = { createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-RD-1' }) };
    rescheduleService = {
      execute: jest.fn().mockResolvedValue({
        rescheduleFee: D('1044'), // 4472/30×7 = 1043.47 → ROUND_UP 1044
        shiftedInstallmentIds: ['i-1', 'i-2'],
        oldDueDates: {},
        newDueDates: {},
      }),
    };
    receiptsService = { generateReceipt: jest.fn().mockResolvedValue({ id: 'rt-1' }) };

    service = new RescheduleCollectService(prisma, journalAuto, rescheduleService, receiptsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  /** All RESCHEDULE_ADVANCE_PARKED audit payloads written during a test. */
  const parkAudits = () =>
    prisma.auditLog.create.mock.calls
      .map((c: AnyObj) => c[0].data)
      .filter((d2: AnyObj) => d2.action === 'RESCHEDULE_ADVANCE_PARKED');

  /** Sentry warnings raised by the short-sweep guard (I-7). */
  const shortSweepWarnings = () =>
    (Sentry.captureMessage as jest.Mock).mock.calls.filter((c) =>
      String(c[0]).includes('park sweep came up short'),
    );

  it('quote(): 6a = fee 1044 + lateFee 100 → collect 1144', async () => {
    const q = await service.quote({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SPLIT',
    });
    expect(q.rescheduleFee).toBe('1044.00');
    expect(q.lateFee).toBe('100.00');
    expect(q.collectAmount).toBe('1144.00');
    expect(q.variant).toBe('6a');
  });

  it('quote(): 6b = ค่างวดคงเหลือ 4472 + fee 1044 + lateFee 100 → collect 5616 (จ่ายทั้งก้อนวันนี้)', async () => {
    const q = await service.quote({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SINGLE',
    });
    expect(q.installmentOutstanding).toBe('4472.00');
    expect(q.rescheduleFee).toBe('1044.00');
    expect(q.lateFee).toBe('100.00');
    expect(q.collectAmount).toBe('5616.00');
    expect(q.variant).toBe('6b');
  });

  it('quote(): 6b nets amountPaid — partially-paid installment only owes the remainder', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      ...paymentRow,
      status: 'PARTIALLY_PAID',
      amountPaid: D('1472.00'),
    });
    const q = await service.quote({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SINGLE',
    });
    expect(q.installmentOutstanding).toBe('3000.00');
    expect(q.collectAmount).toBe('4144.00'); // 3000 + 1044 + 100
  });

  it('6a happy path: JE (Dr 11-1101 1144 / Cr 21-1103 1044 / Cr 42-1103 100) + lateFee reset + reschedule on SAME tx + receipt', async () => {
    const result = await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SPLIT',
      amount: 1144,
      paymentMethod: 'CASH',
      recordedById: 'user-1',
    });

    // JE lines — fee to advance (21-1103), late fee to income (42-1103).
    const je = journalAuto.createAndPost.mock.calls[0][0];
    const line = (code: string) => je.lines.find((l: AnyObj) => l.accountCode === code);
    expect(line('11-1101').dr.toFixed(2)).toBe('1144.00');
    expect(line('21-1103').cr.toFixed(2)).toBe('1044.00');
    // CPA CSV wording (park-at-last-installment, owner directive 2026-08-16) —
    // NOT "เงินรับล่วงหน้า — ..." (that phrasing implied FIFO-next relief).
    expect(line('21-1103').description).toBe(
      'เงินรับล่วงหน้างวดสุดท้าย — ค่าธรรมเนียมปรับดิว (6a)',
    );
    expect(line('42-1103').cr.toFixed(2)).toBe('100.00');
    expect(je.metadata.tag).toBe('reschedule-collect'); // NOT 'receipt' — reconstructPrior must ignore
    // JE posts on the shared tx (2nd arg).
    expect(journalAuto.createAndPost.mock.calls[0][1]).toBe(prisma);

    // Late fee ของช่วงเกินเดิม reset เป็น 0 (เก็บแล้ว).
    const upd = prisma.payment.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'pay-1' });
    expect(upd.data.lateFee).toBe(0);
    expect(upd.data.notes).toContain('เก็บแล้วตอนปรับดิว');

    // Reschedule runs on the SAME tx (atomic with the JE).
    expect(rescheduleService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'ct-1',
        fromInstallmentNo: 1,
        daysToShift: 7,
        variant: '6a',
      }),
      prisma,
    );

    // 6a fee = PREPAYMENT (CPA case 6a), park-at-last-installment (owner
    // directive 2026-08-16): must land on the DEDICATED park bucket
    // (Contract.rescheduleAdvanceBalance) — Cr 21-1103 (JE above) is unchanged
    // (same GL account), but the application-level bucket is now the park one,
    // NOT the generic FIFO advanceBalance.
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'ct-1' },
      data: { rescheduleAdvanceBalance: { increment: expect.anything() } },
    });
    const advAudit = prisma.auditLog.create.mock.calls
      .map((c: AnyObj) => c[0].data)
      .find((d2: AnyObj) => d2.action === 'OVERPAY_ADVANCE_RECORDED');
    expect(advAudit.newValue.advanceCredit).toBe('1044');
    expect(advAudit.newValue.source).toBe('RESCHEDULE_COLLECT_6A_FEE');
    expect(advAudit.newValue.bucket).toBe('RESCHEDULE_PARK');

    // Money-detail audit + post-commit receipt.
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESCHEDULE_COLLECT', entityId: 'pay-1' }),
      }),
    );
    expect(receiptsService.generateReceipt).toHaveBeenCalledWith(
      'ct-1',
      'pay-1',
      'RESCHEDULE_FEE',
      1144,
      1,
      'CASH',
      null,
      'user-1',
    );

    expect(result).toMatchObject({
      success: true,
      variant: '6a',
      rescheduleFee: '1044.00',
      lateFeeCollected: '100.00',
      collectAmount: '1144.00',
      journalEntryNo: 'JE-RD-1',
      shiftedInstallmentCount: 2,
    });
  });

  it('6b direct call (ไม่ผ่าน orchestrator, ไม่มี fixedQuote) → BadRequest, nothing runs', async () => {
    // Owner correction 2026-07-09: 6b = จ่ายทั้งก้อนวันนี้ — the controller must
    // book the bundle through the payment orchestrator first (bundledPaid) or
    // it arrives as a legacy frozen-quote QR webhook. A direct call would try
    // to Dr the full bundle against late-fee-only credits.
    await expect(
      service.executeWithCollect({
        contractId: 'ct-1',
        installmentNo: 1,
        daysToShift: 7,
        splitMode: 'SINGLE',
        amount: 100,
        paymentMethod: 'CASH',
        recordedById: 'user-1',
      }),
    ).rejects.toThrow(/ต้องบันทึกรับชำระผ่าน/);

    expect(journalAuto.createAndPost).not.toHaveBeenCalled();
    expect(rescheduleService.execute).not.toHaveBeenCalled();
  });

  it('6b bundledPaid (phase 2), NOTHING to sweep: NO JE, NO receipt, NO lateFee reset — shifts from installmentNo+1, PAID row allowed', async () => {
    // Phase 1 (controller) already booked installment + fee + late fee through
    // the orchestrator — the row is PAID by the time phase 2 runs. Fresh
    // contract read (mocked in beforeEach) shows generic advanceBalance = 0 —
    // e.g. phase 1's overage rounded to ≤1฿ and never crossed the D1 auto-route
    // threshold — so there is nothing to sweep into the park bucket.
    prisma.payment.findFirst.mockResolvedValue({ ...paymentRow, status: 'PAID' });

    const result = await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SINGLE',
      amount: 5616, // the actual phase-1 bundle (4472 + 1044 + 100)
      paymentMethod: 'CASH',
      recordedById: 'user-1',
      bundledPaid: true,
    });

    expect(journalAuto.createAndPost).not.toHaveBeenCalled();
    expect(receiptsService.generateReceipt).not.toHaveBeenCalled();
    // Sweep gate reads the fresh balance (0 in this fixture) → nothing to move.
    expect(prisma.contract.update).not.toHaveBeenCalled();
    expect(parkAudits()).toHaveLength(0);
    // I-7: a ZERO sweep is the worst case (the fee stayed FIFO) and used to be
    // completely silent — no audit row fires when sweep == 0, so Sentry is the
    // ONLY signal that this contract's fee never reached the park bucket.
    expect(shortSweepWarnings()).toHaveLength(1);
    expect(shortSweepWarnings()[0][1].extra).toMatchObject({
      expectedFee: '1044.00',
      sweptAmount: '0.00',
      genericBalanceAtSweep: '0.00',
    });

    // Note stamped, but the orchestrator's lateFee stamp is preserved.
    const upd = prisma.payment.update.mock.calls[0][0];
    expect(upd.data.lateFee).toBeUndefined();
    expect(upd.data.notes).toContain('ปรับดิว 6b');

    // งวดนี้จ่ายจบวันนี้ — เลื่อนเฉพาะงวดถัดไป (CPA case 6b)
    expect(rescheduleService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ fromInstallmentNo: 2, variant: '6b' }),
      prisma,
    );

    const audit = prisma.auditLog.create.mock.calls
      .map((c: AnyObj) => c[0].data)
      .find((d2: AnyObj) => d2.action === 'RESCHEDULE_COLLECT');
    expect(audit.newValue.source).toBe('CASHIER_BUNDLED_6B');
    expect(audit.newValue.bundledPaid).toBe(true);
    // Audit + response record the ACTUAL phase-1 bundle, not the zeroed phase-2 quote.
    expect(audit.newValue.collectAmount).toBe('5616.00');
    expect(result.collectAmount).toBe('5616.00');
    expect(result.success).toBe(true);
  });

  it('6b bundledPaid (phase 2), park sweep: phase-1 generic advance ≥ fee → sweeps min(fee, generic) into rescheduleAdvanceBalance', async () => {
    // Phase 1 (orchestrator, not the SUT here) already D1-auto-routed the
    // fee-sized overage into the GENERIC advance bucket (it has no way to know
    // this payment was a reschedule fee). Simulate that: fresh contract read
    // shows generic advanceBalance = 1044 (== the fee) — possibly plus some
    // UNRELATED pre-existing advance (200) that must NOT be swept.
    prisma.payment.findFirst.mockResolvedValue({ ...paymentRow, status: 'PAID' });
    prisma.contract.findUniqueOrThrow.mockResolvedValue({
      advanceBalance: D('1244'), // 1044 (this fee) + 200 (unrelated, pre-existing)
      rescheduleAdvanceBalance: D('0'),
    });

    const result = await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SINGLE',
      amount: 5616,
      paymentMethod: 'CASH',
      recordedById: 'user-1',
      bundledPaid: true,
    });

    // Sweep = min(fee 1044, generic 1244) = 1044 — the unrelated 200 stays generic.
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'ct-1' },
      data: {
        advanceBalance: { decrement: expect.anything() },
        rescheduleAdvanceBalance: { increment: expect.anything() },
      },
    });
    const sweepCall = prisma.contract.update.mock.calls.find(
      (c: AnyObj) => c[0].data.advanceBalance?.decrement !== undefined,
    );
    expect(sweepCall[0].data.advanceBalance.decrement.toString()).toBe('1044');
    expect(sweepCall[0].data.rescheduleAdvanceBalance.increment.toString()).toBe('1044');

    const sweepAudit = prisma.auditLog.create.mock.calls
      .map((c: AnyObj) => c[0].data)
      .find((d2: AnyObj) => d2.action === 'RESCHEDULE_ADVANCE_PARKED');
    expect(sweepAudit).toBeDefined();
    expect(sweepAudit.newValue.sweptAmount).toBe('1044');
    expect(sweepAudit.newValue.beforeGenericBalance).toBe('1244');
    expect(sweepAudit.newValue.afterGenericBalance).toBe('200');
    expect(sweepAudit.newValue.source).toBe('RESCHEDULE_COLLECT_6B_FEE_SWEEP');

    // I-7 negative control: a FULL sweep must not raise a false alarm.
    expect(shortSweepWarnings()).toHaveLength(0);

    expect(result.success).toBe(true);
  });

  it('6b bundledPaid (phase 2), park sweep capped: phase-1 generic advance < fee → sweeps only what is there', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...paymentRow, status: 'PAID' });
    prisma.contract.findUniqueOrThrow.mockResolvedValue({
      advanceBalance: D('500'), // less than the fee (1044) — e.g. partial rounding drift
      rescheduleAdvanceBalance: D('0'),
    });

    await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SINGLE',
      amount: 5616,
      paymentMethod: 'CASH',
      recordedById: 'user-1',
      bundledPaid: true,
    });

    const sweepCall = prisma.contract.update.mock.calls.find(
      (c: AnyObj) => c[0].data.advanceBalance?.decrement !== undefined,
    );
    expect(sweepCall[0].data.advanceBalance.decrement.toString()).toBe('500');
    expect(sweepCall[0].data.rescheduleAdvanceBalance.increment.toString()).toBe('500');

    // I-7: 500 swept vs a 1044 fee → 544 of the fee stayed in the FIFO bucket
    // (phase 1 committed in the controller; anything could have drained the
    // generic bucket before phase 2 opened its own tx). Used to return success
    // with zero signal.
    expect(shortSweepWarnings()).toHaveLength(1);
    expect(shortSweepWarnings()[0][1]).toMatchObject({
      level: 'warning',
      tags: { subsystem: 'reschedule-park' },
      extra: expect.objectContaining({
        contractId: 'ct-1',
        paymentId: 'pay-1',
        expectedFee: '1044.00',
        sweptAmount: '500.00',
      }),
    });
  });

  it('M-3: retried 6b phase 2 (bundledPaid) does NOT sweep a second time — the RESCHEDULE_ADVANCE_PARKED audit row is the idempotency marker', async () => {
    // Retry path: the controller skips phase 1 when the payment already reads
    // PAID and calls phase 2 again. Before the guard this swept ANOTHER
    // min(fee, generic) out of the customer's unrelated generic advance.
    prisma.payment.findFirst.mockResolvedValue({ ...paymentRow, status: 'PAID' });
    // The first (successful) run already moved 1044; 200 unrelated advance is
    // all that survives — exactly the money a second sweep would steal.
    prisma.contract.findUniqueOrThrow.mockResolvedValue({
      advanceBalance: D('200'),
      rescheduleAdvanceBalance: D('1044'),
    });
    // R-2: the probe is now a PAIR — a PARKED row and an UNPARKED row, newest
    // wins — so the mock must answer per action. Only PARKED exists here (this
    // receipt was never voided), so the sweep is still in effect.
    prisma.auditLog.findFirst.mockImplementation((args: AnyObj) =>
      Promise.resolve(
        args?.where?.action === 'RESCHEDULE_ADVANCE_PARKED'
          ? { id: 'al-parked-1', createdAt: new Date('2026-08-16T10:00:00Z'), newValue: {} }
          : null,
      ),
    );

    const result = await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SINGLE',
      amount: 5616,
      paymentMethod: 'CASH',
      recordedById: 'user-1',
      bundledPaid: true,
    });

    // Idempotency probe is scoped to this contract AND this payment.
    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: 'RESCHEDULE_ADVANCE_PARKED',
          entity: 'contract',
          entityId: 'ct-1',
          newValue: { path: ['paymentId'], equals: 'pay-1' },
        }),
      }),
    );
    // No balance move, no duplicate audit row.
    expect(
      prisma.contract.update.mock.calls.filter(
        (c: AnyObj) => c[0].data.advanceBalance?.decrement !== undefined,
      ),
    ).toHaveLength(0);
    expect(parkAudits()).toHaveLength(0);
    // Not a short sweep — nothing was expected to move, so no false alarm.
    expect(shortSweepWarnings()).toHaveLength(0);
    // The rest of phase 2 (shift + audit) still runs — a retry must still
    // converge on shifted due dates.
    expect(rescheduleService.execute).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('R-2: void → re-pay sweeps AGAIN — an UNPARKED row newer than PARKED releases the idempotency guard', async () => {
    // Voiding the 6b receipt takes the fee back out of the park bucket and writes
    // RESCHEDULE_ADVANCE_UNPARKED (audit rows are immutable, so the reversal is a
    // new row). The void reuses the SAME payment row, so probing for a PARKED row
    // alone would find the stale one and refuse to re-park the fee on re-payment —
    // silently reinstating the FIFO behaviour the owner directive removed.
    prisma.payment.findFirst.mockResolvedValue({ ...paymentRow, status: 'PAID' });
    prisma.contract.findUniqueOrThrow.mockResolvedValue({
      advanceBalance: D('1244'),
      rescheduleAdvanceBalance: D('0'),
    });
    prisma.auditLog.findFirst.mockImplementation((args: AnyObj) =>
      Promise.resolve(
        args?.where?.action === 'RESCHEDULE_ADVANCE_PARKED'
          ? { id: 'al-parked-1', createdAt: new Date('2026-08-16T10:00:00Z'), newValue: {} }
          : // The void happened AFTER the original sweep → guard released.
            { id: 'al-unparked-1', createdAt: new Date('2026-08-17T10:00:00Z'), newValue: {} },
      ),
    );

    const result = await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SINGLE',
      amount: 5616,
      paymentMethod: 'CASH',
      recordedById: 'user-1',
      bundledPaid: true,
    });

    // The fee is parked again: generic 1244 → park, bounded by the fee (1044).
    const sweepUpdate = prisma.contract.update.mock.calls.find(
      (c: AnyObj) => c[0].data.advanceBalance?.decrement !== undefined,
    );
    expect(sweepUpdate).toBeDefined();
    expect(sweepUpdate[0].data.advanceBalance.decrement.toString()).toBe('1044');
    expect(sweepUpdate[0].data.rescheduleAdvanceBalance.increment.toString()).toBe('1044');
    expect(parkAudits()).toHaveLength(1);
    expect(shortSweepWarnings()).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  it('bundledPaid with SPLIT → BadRequest (ใช้ได้เฉพาะ 6b)', async () => {
    await expect(
      service.executeWithCollect({
        contractId: 'ct-1',
        installmentNo: 1,
        daysToShift: 7,
        splitMode: 'SPLIT',
        amount: 0,
        paymentMethod: 'CASH',
        recordedById: 'user-1',
        bundledPaid: true,
      }),
    ).rejects.toThrow(/เฉพาะโหมดชำระทั้งก้อน/);
  });

  it('amount mismatch vs server quote → BadRequest, nothing posted, no reschedule', async () => {
    await expect(
      service.executeWithCollect({
        contractId: 'ct-1',
        installmentNo: 1,
        daysToShift: 7,
        splitMode: 'SPLIT',
        amount: 1044, // stale UI — forgot late fee 100
        paymentMethod: 'CASH',
        recordedById: 'user-1',
      }),
    ).rejects.toThrow(/ยอดเรียกเก็บเปลี่ยน/);

    expect(journalAuto.createAndPost).not.toHaveBeenCalled();
    expect(rescheduleService.execute).not.toHaveBeenCalled();
  });

  it('โอน (BANK_TRANSFER) without ref/slip → BadRequest', async () => {
    await expect(
      service.executeWithCollect({
        contractId: 'ct-1',
        installmentNo: 1,
        daysToShift: 7,
        splitMode: 'SPLIT',
        amount: 1144,
        paymentMethod: 'BANK_TRANSFER',
        recordedById: 'user-1',
      }),
    ).rejects.toThrow(/หลักฐานการชำระเงิน/);
    expect(rescheduleService.execute).not.toHaveBeenCalled();
  });

  it('QR-webhook path (fixedQuote): books the frozen quote, skips the mismatch check', async () => {
    await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SPLIT',
      amount: 1144,
      paymentMethod: 'ONLINE_GATEWAY',
      recordedById: 'system-owner',
      transactionRef: 'REF-QR-1',
      depositAccountCode: '11-1201',
      fixedQuote: { rescheduleFee: '1044', lateFee: '100', collectAmount: '1144' },
    });

    const je = journalAuto.createAndPost.mock.calls[0][0];
    const line = (code: string) => je.lines.find((l: AnyObj) => l.accountCode === code);
    expect(line('11-1201').dr.toFixed(2)).toBe('1144.00');
    expect(line('21-1103').cr.toFixed(2)).toBe('1044.00');
    expect(line('42-1103').cr.toFixed(2)).toBe('100.00');
    // 6a via QR: park bucket still maintained (park-at-last-installment).
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'ct-1' },
      data: { rescheduleAdvanceBalance: { increment: expect.anything() } },
    });
    const audit = prisma.auditLog.create.mock.calls
      .map((c: AnyObj) => c[0].data)
      .find((d2: AnyObj) => d2.action === 'RESCHEDULE_COLLECT');
    expect(audit.newValue.source).toBe('QR_WEBHOOK');
  });

  it('PAID installment → BadRequest (ไม่ต้องปรับดิว)', async () => {
    prisma.payment.findFirst.mockResolvedValue({ ...paymentRow, status: 'PAID' });
    await expect(
      service.executeWithCollect({
        contractId: 'ct-1',
        installmentNo: 1,
        daysToShift: 7,
        splitMode: 'SPLIT',
        amount: 1144,
        paymentMethod: 'CASH',
        recordedById: 'user-1',
      }),
    ).rejects.toThrow(/ชำระแล้ว/);
  });

  it('closed accounting period (past grace) → BadRequest BEFORE any write (no tx, no JE, no reschedule)', async () => {
    // Period-lock (CR-7): the collect JE posts TODAY, so validatePeriodOpen checks
    // the CURRENT month. A CLOSED period only rejects past the grace window
    // (last calendar day + period_grace_days) — park "today" at noon LOCAL on the
    // last day of July with grace 0 so graceEnd (Jul 31 00:00) is already behind us.
    jest.setSystemTime(new Date(2026, 6, 31, 12, 0, 0));
    prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });
    prisma.systemConfig.findUnique.mockImplementation(({ where }: AnyObj) =>
      Promise.resolve(where.key === 'period_grace_days' ? { value: '0' } : null),
    );

    const attempt = service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SPLIT',
      amount: 1144,
      paymentMethod: 'CASH',
      recordedById: 'user-1',
    });
    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow(/งวดที่ปิดแล้ว/);

    // Guard looked up TODAY's FINANCE period (parity with recordPayment).
    expect(prisma.accountingPeriod.findUnique).toHaveBeenCalledWith({
      where: { companyId_year_month: { companyId: 'co-FINANCE', year: 2026, month: 7 } },
      select: { status: true },
    });
    // Rejected BEFORE the money tx opened — nothing written anywhere.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(journalAuto.createAndPost).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.contract.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(rescheduleService.execute).not.toHaveBeenCalled();
    expect(receiptsService.generateReceipt).not.toHaveBeenCalled();
  });

  it('post-commit receipt failure: generateReceipt rejects → still success:true (เงิน commit แล้ว), error logged not thrown', async () => {
    receiptsService.generateReceipt.mockRejectedValue(new Error('receipt service down'));
    const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => {});

    const result = await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SPLIT',
      amount: 1144,
      paymentMethod: 'CASH',
      recordedById: 'user-1',
    });

    // I3 ordering: money committed before the receipt attempt — result unaffected.
    expect(result).toMatchObject({
      success: true,
      variant: '6a',
      collectAmount: '1144.00',
      journalEntryNo: 'JE-RD-1',
    });
    expect(journalAuto.createAndPost).toHaveBeenCalledTimes(1);
    expect(rescheduleService.execute).toHaveBeenCalledTimes(1);
    expect(receiptsService.generateReceipt).toHaveBeenCalledTimes(1);
    // Failure surfaced to the log (message + stack), never rethrown.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to generate reschedule-collect receipt'),
      expect.any(String),
    );
  });
});
