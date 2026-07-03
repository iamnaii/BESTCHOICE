/**
 * RescheduleCollectService — ปรับดิว collect-first (owner directive 2026-07-02).
 *
 * Locks the money semantics of "เงินไม่เข้า ดิวไม่เลื่อน":
 *   - 6a: collect JE = Dr deposit (fee+ค่าปรับ) / Cr 21-1103 fee / Cr 42-1103 ค่าปรับ
 *   - 6b: ค่าปรับ only; zero-collect (no fee, no late fee) → NO JE, reschedule still runs
 *   - Payment.lateFee resets to 0 AFTER collecting (new overdue period starts clean)
 *   - amount mismatch vs the server quote → BadRequest, nothing posted
 *   - โอน requires ref/slip; QR-webhook path (fixedQuote) books the frozen quote
 *   - reschedule + JE + audit share ONE $transaction; e-Receipt fires post-commit
 *
 * Hand-mocked Prisma ($transaction(cb) → cb(tx), tx === root) mirroring the
 * orchestrator spec pattern. Late-fee config keys resolve to null → PER_DAY
 * defaults (20฿/day, max 500, cap 5%).
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  // Mockup TEST-20260630-003: monthly 4,472; overdue 5 days → lateFee 100 (5×20).
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
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(paymentRow),
        update: jest.fn().mockResolvedValue({}),
      },
      installmentSchedule: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sched-1' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'al-1' }) },
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

    service = new RescheduleCollectService(
      prisma,
      journalAuto,
      rescheduleService,
      receiptsService,
    );
  });

  afterEach(() => jest.useRealTimers());

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
      expect.objectContaining({ contractId: 'ct-1', fromInstallmentNo: 1, daysToShift: 7, variant: '6a' }),
      prisma,
    );

    // 6a fee = PREPAYMENT (CPA case 6a): must land on the REAL advance ledger
    // pair — Cr 21-1103 (JE above) + Contract.advanceBalance — so the existing
    // advance machinery relieves it against upcoming installments (review C1).
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'ct-1' },
      data: { advanceBalance: { increment: expect.anything() } },
    });
    const advAudit = prisma.auditLog.create.mock.calls
      .map((c: AnyObj) => c[0].data)
      .find((d2: AnyObj) => d2.action === 'OVERPAY_ADVANCE_RECORDED');
    expect(advAudit.newValue.advanceCredit).toBe('1044');
    expect(advAudit.newValue.source).toBe('RESCHEDULE_COLLECT_6A_FEE');

    // Money-detail audit + post-commit receipt.
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESCHEDULE_COLLECT', entityId: 'pay-1' }),
      }),
    );
    expect(receiptsService.generateReceipt).toHaveBeenCalledWith(
      'ct-1', 'pay-1', 'RESCHEDULE_FEE', 1144, 1, 'CASH', null, 'user-1',
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

  it('6b: collects ONLY the late fee (Dr 100 / Cr 42-1103 100, no 21-1103 line)', async () => {
    await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SINGLE',
      amount: 100,
      paymentMethod: 'CASH',
      recordedById: 'user-1',
    });

    const je = journalAuto.createAndPost.mock.calls[0][0];
    const codes = je.lines.map((l: AnyObj) => l.accountCode);
    expect(codes).toEqual(['11-1101', '42-1103']);
    expect(je.lines[0].dr.toFixed(2)).toBe('100.00');
    expect(je.lines[1].cr.toFixed(2)).toBe('100.00');
  });

  it('6b + no late fee (not overdue): NO JE, NO lateFee reset, NO receipt, NO advance — reschedule still runs + fee note stamped', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      ...paymentRow,
      dueDate: new Date('2026-07-20T05:00:00Z'),
      lateFee: D(0),
    });

    const result = await service.executeWithCollect({
      contractId: 'ct-1',
      installmentNo: 1,
      daysToShift: 7,
      splitMode: 'SINGLE',
      amount: 0.01, // DTO placeholder — ignored when quote collect = 0
      paymentMethod: 'CASH',
      recordedById: 'user-1',
    });

    expect(journalAuto.createAndPost).not.toHaveBeenCalled();
    expect(receiptsService.generateReceipt).not.toHaveBeenCalled();
    expect(prisma.contract.update).not.toHaveBeenCalled(); // 6b — no advance now
    // 6b: the deferred fee is stamped on the installment note (collected with the
    // installment; the orchestrator's D1 auto-route parks the overage as advance).
    const upd = prisma.payment.update.mock.calls[0][0];
    expect(upd.data.lateFee).toBeUndefined(); // no fee to reset
    expect(upd.data.notes).toContain('ค่าธรรมเนียมปรับดิว');
    expect(upd.data.notes).toContain('(6b)');
    expect(rescheduleService.execute).toHaveBeenCalled();
    expect(result.collectAmount).toBe('0.00');
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
    // 6a via QR: advance ledger pair still maintained.
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'ct-1' },
      data: { advanceBalance: { increment: expect.anything() } },
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
        splitMode: 'SINGLE',
        amount: 100,
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
