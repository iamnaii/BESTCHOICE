import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  COMMISSION_PAY_VIA_PAYROLL_CODE,
  COMMISSION_PAY_VIA_PAYROLL_MSG,
  clawBackCommissions,
  clawbackAmountOf,
  type ClawbackCandidate,
} from '../commission-clawback.util';
import { isCoveredByPayout } from '../commission-payout-cover.util';

const D = (v: number | string) => new Prisma.Decimal(v);
const asTx = (tx: unknown) => tx as Prisma.TransactionClient;
const now = new Date('2026-10-28T03:00:00Z');
const PAID_AT = new Date('2026-10-01T04:00:00Z');

const row = (o: Partial<ClawbackCandidate> = {}): ClawbackCandidate => ({
  id: 'cm-1',
  status: 'PENDING',
  commissionAmount: D('800'),
  paidAt: null,
  paidAmount: null,
  ...o,
});

function buildTx(count = 1) {
  return { salesCommission: { updateMany: jest.fn().mockResolvedValue({ count }) } };
}

describe('clawBackCommissions — one helper for sale void, credit-return cleanup, the default cron and contract cancellation', () => {
  it('unpaid row at 100% → CLAWED_BACK with clawbackAmount null (nothing was paid, nothing to deduct)', async () => {
    const tx = buildTx();
    const res = await clawBackCommissions(asTx(tx), [row()], { reason: 'ยกเลิกใบขาย SA-1: คีย์ผิด', now });
    expect(tx.salesCommission.updateMany).toHaveBeenCalledWith({
      where: { id: 'cm-1', status: 'PENDING' },
      data: {
        status: 'CLAWED_BACK',
        clawbackAmount: null,
        clawbackPercent: 100,
        clawbackAt: now,
        clawbackReason: 'ยกเลิกใบขาย SA-1: คีย์ผิด',
      },
    });
    expect(res.unpaidIds).toEqual(['cm-1']);
    expect(res.paidIds).toEqual([]);
    expect(res.paidTotal.toFixed(2)).toBe('0.00');
  });

  it('PAID 800 at 100% → CLAWED_BACK with clawbackAmount 800.00 (the amount the next payroll deducts)', async () => {
    const tx = buildTx();
    const res = await clawBackCommissions(
      asTx(tx),
      [row({ status: 'PAID', paidAt: PAID_AT, paidAmount: D('800') })],
      { reason: 'r', now },
    );
    const call = tx.salesCommission.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'cm-1', status: 'PAID' });
    expect(call.data.status).toBe('CLAWED_BACK');
    expect(call.data.clawbackAmount).toBeInstanceOf(Prisma.Decimal);
    expect(call.data.clawbackAmount.toFixed(2)).toBe('800.00');
    expect(res.paidIds).toEqual(['cm-1']);
    expect(res.unpaidIds).toEqual([]);
    expect(res.paidTotal.toFixed(2)).toBe('800.00');
  });

  it('paid PARTIALLY_CLAWED_BACK row at 100% → CLAWED_BACK with clawbackAmount = paidAmount (not the earlier partial amount)', async () => {
    const tx = buildTx();
    const res = await clawBackCommissions(
      asTx(tx),
      [row({ status: 'PARTIALLY_CLAWED_BACK', commissionAmount: D('1000'), paidAt: PAID_AT, paidAmount: D('1000') })],
      { reason: 'r', now },
    );
    const call = tx.salesCommission.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'cm-1', status: 'PARTIALLY_CLAWED_BACK' });
    expect(call.data.status).toBe('CLAWED_BACK');
    expect(call.data.clawbackAmount.toFixed(2)).toBe('1000.00');
    expect(res.paidTotal.toFixed(2)).toBe('1000.00');
  });

  it('percent 50 on PAID 1,000 → PARTIALLY_CLAWED_BACK 500.00', async () => {
    const tx = buildTx();
    const res = await clawBackCommissions(
      asTx(tx),
      [row({ status: 'PAID', commissionAmount: D('1000'), paidAt: PAID_AT, paidAmount: D('1000') })],
      { reason: 'cron', now, percent: 50 },
    );
    const call = tx.salesCommission.updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('PARTIALLY_CLAWED_BACK');
    expect(call.data.clawbackPercent).toBe(50);
    expect(call.data.clawbackAmount.toFixed(2)).toBe('500.00');
    expect(res.paidTotal.toFixed(2)).toBe('500.00');
  });

  it('percent 50 on an unpaid APPROVED 1,000 → PARTIALLY_CLAWED_BACK 500.00 from commissionAmount, not counted as paid', async () => {
    const tx = buildTx();
    const res = await clawBackCommissions(
      asTx(tx),
      [row({ status: 'APPROVED', commissionAmount: D('1000') })],
      { reason: 'cron', now, percent: 50 },
    );
    const call = tx.salesCommission.updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('PARTIALLY_CLAWED_BACK');
    expect(call.data.clawbackAmount.toFixed(2)).toBe('500.00');
    expect(res.unpaidIds).toEqual(['cm-1']);
    expect(res.paidTotal.toFixed(2)).toBe('0.00');
  });

  it('rounds HALF_UP to 2 dp (100.01 × 50% = 50.005 → 50.01, not banker\'s 50.00)', async () => {
    const tx = buildTx();
    const res = await clawBackCommissions(
      asTx(tx),
      [row({ status: 'PAID', commissionAmount: D('100.01'), paidAt: PAID_AT, paidAmount: D('100.01') })],
      { reason: 'r', now, percent: 50 },
    );
    expect(tx.salesCommission.updateMany.mock.calls[0][0].data.clawbackAmount.toFixed(2)).toBe('50.01');
    expect(res.paidTotal.toFixed(2)).toBe('50.01');
  });

  it("'paid' means paidAt is set: paidAmount without paidAt is unpaid; paidAt without paidAmount falls back to commissionAmount", async () => {
    const tx = buildTx();
    const res = await clawBackCommissions(
      asTx(tx),
      [
        row({ id: 'a', status: 'APPROVED', paidAt: null, paidAmount: D('800') }),
        row({ id: 'b', status: 'PAID', commissionAmount: D('300'), paidAt: PAID_AT, paidAmount: null }),
      ],
      { reason: 'r', now },
    );
    const [first, second] = tx.salesCommission.updateMany.mock.calls.map((c: [{ data: { clawbackAmount: Prisma.Decimal | null } }]) => c[0]);
    expect(first.data.clawbackAmount).toBeNull();
    expect(second.data.clawbackAmount!.toFixed(2)).toBe('300.00');
    expect(res.unpaidIds).toEqual(['a']);
    expect(res.paidIds).toEqual(['b']);
    expect(res.paidTotal.toFixed(2)).toBe('300.00');
  });

  it('skips rows already CLAWED_BACK — nothing to reverse twice', async () => {
    const tx = buildTx();
    const res = await clawBackCommissions(
      asTx(tx),
      [row({ id: 'done', status: 'CLAWED_BACK', paidAt: PAID_AT, paidAmount: D('800') }), row({ id: 'open' })],
      { reason: 'r', now },
    );
    expect(tx.salesCommission.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.salesCommission.updateMany.mock.calls[0][0].where).toEqual({ id: 'open', status: 'PENDING' });
    expect(res).toEqual({ unpaidIds: ['open'], paidIds: [], paidTotal: expect.any(Prisma.Decimal) });
  });

  it('writes monthsPaidBeforeDefault only when given (the cron), never otherwise', async () => {
    const withMonths = buildTx();
    await clawBackCommissions(asTx(withMonths), [row({ status: 'APPROVED' })], { reason: 'cron', now, percent: 75, monthsPaidBeforeDefault: 3 });
    expect(withMonths.salesCommission.updateMany.mock.calls[0][0].data.monthsPaidBeforeDefault).toBe(3);

    const withoutMonths = buildTx();
    await clawBackCommissions(asTx(withoutMonths), [row()], { reason: 'void', now });
    expect(withoutMonths.salesCommission.updateMany.mock.calls[0][0].data).not.toHaveProperty('monthsPaidBeforeDefault');
  });

  it('writes rows in id order (same order as the payroll post, so two writers never deadlock)', async () => {
    const tx = buildTx();
    await clawBackCommissions(asTx(tx), [row({ id: 'c' }), row({ id: 'a' }), row({ id: 'b' })], { reason: 'r', now });
    expect(tx.salesCommission.updateMany.mock.calls.map((c: [{ where: { id: string } }]) => c[0].where.id)).toEqual(['a', 'b', 'c']);
  });

  it('race: the row changed status since it was read (count ≠ 1) → 409 สถานะค่าคอมเปลี่ยนแล้ว', async () => {
    const tx = buildTx(0);
    await expect(clawBackCommissions(asTx(tx), [row({ status: 'APPROVED' })], { reason: 'r', now })).rejects.toThrow(
      new ConflictException('สถานะค่าคอมเปลี่ยนแล้ว กรุณาตรวจใหม่'),
    );
  });

  it('rejects a percent outside 1–100 (programming error, never a silent PARTIALLY_CLAWED_BACK at 0%)', async () => {
    const tx = buildTx();
    await expect(clawBackCommissions(asTx(tx), [row()], { reason: 'r', now, percent: 0 })).rejects.toThrow(Error);
    await expect(clawBackCommissions(asTx(tx), [row()], { reason: 'r', now, percent: 101 })).rejects.toThrow(Error);
    expect(tx.salesCommission.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing for an empty list', async () => {
    const tx = buildTx();
    const res = await clawBackCommissions(asTx(tx), [], { reason: 'r', now });
    expect(tx.salesCommission.updateMany).not.toHaveBeenCalled();
    expect(res.paidTotal.toFixed(2)).toBe('0.00');
  });
});

describe('clawbackAmountOf — the per-row amount the helper writes', () => {
  it('matches the helper rule for paid and unpaid rows', () => {
    expect(clawbackAmountOf(row(), 100)).toBeNull();
    expect(clawbackAmountOf(row({ status: 'APPROVED', commissionAmount: D('1000') }), 25)!.toFixed(2)).toBe('250.00');
    expect(clawbackAmountOf(row({ status: 'PAID', paidAt: PAID_AT, paidAmount: D('750') }), 100)!.toFixed(2)).toBe('750.00');
  });
});

describe('COMMISSION_PAY_VIA_PAYROLL — the 410 copy is fixed', () => {
  it('is the verbatim copy and code from the plan', () => {
    expect(COMMISSION_PAY_VIA_PAYROLL_MSG).toBe(
      'จ่ายค่าคอมผ่านใบเงินเดือนเท่านั้น — สร้างใบเงินเดือนที่หน้ารายจ่าย › สร้างเอกสารใหม่ › เงินเดือน (PR) ระบบดึงค่าคอมที่อนุมัติแล้วให้เอง',
    );
    expect(COMMISSION_PAY_VIA_PAYROLL_CODE).toBe('COMMISSION_PAY_VIA_PAYROLL');
  });
});

describe('isCoveredByPayout — one cover rule for sale void, credit cleanup and contract cancellation', () => {
  const c = { salespersonId: 'sp1', period: '2026-09', createdAt: new Date('2026-09-20T05:00:00Z') };
  const p = (o: Record<string, unknown> = {}) => ({ salespersonId: 'sp1', period: '2026-09', generatedAt: new Date('2026-09-22T00:00:00Z'), ...o });

  it('covers when the round was generated after (or at) the commission', () => {
    expect(isCoveredByPayout(c, p())).toBe(true);
    expect(isCoveredByPayout(c, p({ generatedAt: c.createdAt }))).toBe(true);
  });

  it('a round without generatedAt (pre-column) cannot be proven otherwise → counts as covering', () => {
    expect(isCoveredByPayout(c, p({ generatedAt: null }))).toBe(true);
  });

  it('does not cover a round generated before the commission existed', () => {
    expect(isCoveredByPayout(c, p({ generatedAt: new Date('2026-09-19T00:00:00Z') }))).toBe(false);
  });

  it('does not cover another salesperson or another period', () => {
    expect(isCoveredByPayout(c, p({ salespersonId: 'sp2' }))).toBe(false);
    expect(isCoveredByPayout(c, p({ period: '2026-10' }))).toBe(false);
  });
});
