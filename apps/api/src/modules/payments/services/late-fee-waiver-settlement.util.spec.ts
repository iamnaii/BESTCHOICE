jest.mock('@sentry/node', () => ({ captureMessage: jest.fn() }));

import * as Sentry from '@sentry/node';
import { Prisma } from '@prisma/client';
import {
  alarmIfLargeLateFeeWaiver,
  applyLateFeeWaiverInTx,
  computeWaiverSettlement,
  LARGE_LATE_FEE_WAIVER_ALARM_THB,
  loadWaiverSettlements,
  waiverSettlesInstallment,
} from './late-fee-waiver-settlement.util';

const D = (v: string | number) => new Prisma.Decimal(v);
const money = (d: Prisma.Decimal) => d.toFixed(2);

describe('computeWaiverSettlement', () => {
  it('fee-first receipt of exactly amountDue: fee fully collected → nothing waivable, principal still owed', () => {
    // 1,515.83 received while a 100 fee was due → Cr 42-1103 100 + Cr 11-2103 1,415.83.
    const s = computeWaiverSettlement({
      amountDue: '1515.83',
      amountPaid: '1515.83',
      lateFee: '100',
      feePaid: '100',
    });
    expect(money(s.waivableFee)).toBe('0.00');
    expect(money(s.retainedLateFee)).toBe('100.00');
    expect(money(s.principalPaid)).toBe('1415.83');
    expect(money(s.principalShortfall)).toBe('100.00');
    expect(s.principalSettled).toBe(false);
  });

  it('partly collected fee: waives only the uncollected remainder and keeps the collected part as the charge', () => {
    const s = computeWaiverSettlement({
      amountDue: '1515.83',
      amountPaid: '50',
      lateFee: '100',
      feePaid: '50',
    });
    expect(money(s.waivableFee)).toBe('50.00');
    expect(money(s.retainedLateFee)).toBe('50.00');
    expect(money(s.principalPaid)).toBe('0.00');
    expect(money(s.principalShortfall)).toBe('1515.83');
    expect(s.principalSettled).toBe(false);
  });

  it('principal covered and fee never collected → whole fee waivable, settled', () => {
    const s = computeWaiverSettlement({
      amountDue: '1515.83',
      amountPaid: '1515.83',
      lateFee: '100',
      feePaid: '0',
    });
    expect(money(s.waivableFee)).toBe('100.00');
    expect(money(s.retainedLateFee)).toBe('0.00');
    expect(s.principalSettled).toBe(true);
  });

  it('legacy row without fee entries (feePaid 0) settles exactly like amountPaid ≥ amountDue', () => {
    const covered = computeWaiverSettlement({ amountDue: 1000, amountPaid: 1000, lateFee: 50, feePaid: 0 });
    const short = computeWaiverSettlement({ amountDue: 1000, amountPaid: 999.99, lateFee: 50, feePaid: 0 });
    expect(covered.principalSettled).toBe(true);
    expect(short.principalSettled).toBe(false);
  });

  describe('tolerance boundary (strict — no ≤1฿ close without a Dr 52-1104 posting)', () => {
    const at = (amountPaid: string) =>
      computeWaiverSettlement({ amountDue: '1515.83', amountPaid, lateFee: '100', feePaid: '100' });

    it('shortfall 0.00 → settled', () => {
      const s = at('1615.83');
      expect(money(s.principalShortfall)).toBe('0.00');
      expect(s.principalSettled).toBe(true);
    });

    it('shortfall 0.01 → NOT settled', () => {
      const s = at('1615.82');
      expect(money(s.principalShortfall)).toBe('0.01');
      expect(s.principalSettled).toBe(false);
    });

    it('shortfall 1.00 (the receipt template TOLERANCE) → still NOT settled', () => {
      const s = at('1614.83');
      expect(money(s.principalShortfall)).toBe('1.00');
      expect(s.principalSettled).toBe(false);
    });

    it('overpaid principal → settled, shortfall clamps at 0', () => {
      const s = at('1700.00');
      expect(money(s.principalShortfall)).toBe('0.00');
      expect(s.principalSettled).toBe(true);
    });
  });

  it('ledger fee above the stored charge never produces a negative waiver or retained fee', () => {
    const s = computeWaiverSettlement({ amountDue: 1000, amountPaid: 1200, lateFee: 100, feePaid: 200 });
    expect(money(s.waivableFee)).toBe('0.00');
    expect(money(s.retainedLateFee)).toBe('100.00');
    expect(money(s.principalPaid)).toBe('1000.00');
    expect(s.principalSettled).toBe(true);
  });
});

describe('waiverSettlesInstallment', () => {
  const settled = computeWaiverSettlement({ amountDue: 100, amountPaid: 100, lateFee: 50, feePaid: 0 });
  const open = computeWaiverSettlement({ amountDue: 100, amountPaid: 99, lateFee: 50, feePaid: 0 });

  it('settles only a principal-covered, unpaid row on a collectable contract', () => {
    expect(waiverSettlesInstallment(settled, 'PARTIALLY_PAID', 'ACTIVE')).toBe(true);
    expect(waiverSettlesInstallment(settled, 'OVERDUE', 'OVERDUE')).toBe(true);
    expect(waiverSettlesInstallment(settled, 'PARTIALLY_PAID', 'DEFAULT')).toBe(true);
  });

  it('never settles an open principal, an already-PAID row, or a closed contract', () => {
    expect(waiverSettlesInstallment(open, 'PARTIALLY_PAID', 'ACTIVE')).toBe(false);
    expect(waiverSettlesInstallment(settled, 'PAID', 'ACTIVE')).toBe(false);
    for (const status of ['TERMINATED', 'CLOSED_BAD_DEBT', 'EXCHANGED', 'COMPLETED'] as const) {
      expect(waiverSettlesInstallment(settled, 'PARTIALLY_PAID', status)).toBe(false);
    }
    expect(waiverSettlesInstallment(settled, 'PARTIALLY_PAID', undefined)).toBe(false);
  });
});

describe('loadWaiverSettlements', () => {
  it('reads the ledger only for rows with money paid and nets waived fee', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        metadata: { tag: 'receipt', paymentId: 'p-paid' },
        status: 'POSTED',
        deletedAt: null,
        lines: [{ accountCode: '42-1103', debit: D(0), credit: D(100), deletedAt: null }],
      },
    ]);
    const out = await loadWaiverSettlements({ journalEntry: { findMany } } as never, [
      { id: 'p-paid', amountDue: D('1515.83'), amountPaid: D('1515.83'), lateFee: D(100) },
      { id: 'p-unpaid', amountDue: D('1515.83'), amountPaid: D(0), lateFee: D(100) },
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).not.toContain('p-unpaid');
    expect(money(out.get('p-paid')!.feePaid)).toBe('100.00');
    expect(money(out.get('p-paid')!.waivableFee)).toBe('0.00');
    expect(money(out.get('p-unpaid')!.waivableFee)).toBe('100.00');
  });

  it('skips the ledger read entirely when nothing was paid', async () => {
    const findMany = jest.fn();
    await loadWaiverSettlements({ journalEntry: { findMany } } as never, [
      { id: 'p', amountDue: 100, amountPaid: 0, lateFee: 50 },
    ]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('applyLateFeeWaiverInTx', () => {
  const tx = () => ({
    payment: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    feeWaiverApproval: { create: jest.fn().mockResolvedValue({}) },
  });
  const base = {
    payment: { id: 'p1', status: 'PARTIALLY_PAID' as const, notes: 'เดิม' },
    waivedById: 'maker',
    approverId: 'approver',
    reason: 'ลูกค้าป่วย',
    waivedAt: new Date('2026-11-05T03:00:00Z'),
  };

  it('partly collected fee: charge reduced to the collected part (still a real charge), remainder waived, status untouched', async () => {
    const t = tx();
    const settlement = computeWaiverSettlement({ amountDue: 1515.83, amountPaid: 50, lateFee: 100, feePaid: 50 });
    await applyLateFeeWaiverInTx(t as never, { ...base, settlement, settles: false });
    const data = t.payment.update.mock.calls[0][0].data;
    expect(money(data.lateFee)).toBe('50.00');
    expect(money(data.waivedAmount)).toBe('50.00');
    expect(data.lateFeeWaived).toBe(false);
    expect(data.status).toBeUndefined();
    expect(data.paidDate).toBeUndefined();
    expect(data.notes).toBe('เดิม | ยกเว้นค่าปรับ 50 บาท — ลูกค้าป่วย');
    expect(t.feeWaiverApproval.create).toHaveBeenCalledWith({
      data: { waiverPaymentId: 'p1', approverId: 'approver', ipAddress: null, userAgent: null },
    });
  });

  it('flips PAID + paidDate only when settling', async () => {
    const t = tx();
    const settlement = computeWaiverSettlement({ amountDue: 100, amountPaid: 100, lateFee: 50, feePaid: 0 });
    await applyLateFeeWaiverInTx(t as never, { ...base, settlement, settles: true });
    const data = t.payment.update.mock.calls[0][0].data;
    expect(data.status).toBe('PAID');
    expect(data.paidDate).toEqual(base.waivedAt);
    expect(money(data.lateFee)).toBe('0.00');
    expect(data.lateFeeWaived).toBe(true); // fully waived ⇒ lateFee 0 (the readers' invariant)
    expect(money(data.waivedAmount)).toBe('50.00');
  });
});

describe('alarmIfLargeLateFeeWaiver', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fires above the threshold, not at it', () => {
    alarmIfLargeLateFeeWaiver(D(LARGE_LATE_FEE_WAIVER_ALARM_THB), { paymentId: 'p' });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    alarmIfLargeLateFeeWaiver(D('5000.01'), { paymentId: 'p' });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Large late-fee waiver',
      expect.objectContaining({ extra: expect.objectContaining({ amount: 5000.01, paymentId: 'p' }) }),
    );
  });
});
