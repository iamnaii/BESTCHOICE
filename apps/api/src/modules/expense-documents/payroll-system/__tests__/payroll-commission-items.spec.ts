import { ConflictException } from '@nestjs/common';
import { releaseCommissionItems, revertCommissionPayment } from '../payroll-commission-items';

/**
 * Payroll D4 ส่วนที่ 2 · Task 4 — ผู้เขียนรายการ/สถานะค่าคอมของใบเงินเดือน (client ปลอม)
 * - revertCommissionPayment: กติกาเดียวของกลับรายการ (P2-R5) และ CLI ล้างใบเงินเดือน (P2-R25) — CAS ตามสถานะ ·
 *   ได้ ≠ 1 แถว = 409 "สถานะค่าคอมเปลี่ยนแล้ว กรุณาตรวจใหม่" (ไม่ข้ามเงียบ)
 * - releaseCommissionItems: ปล่อยเฉพาะรายการที่ยังมีผลของใบ (P2-R13)
 */

const PAID_AT = new Date('2026-10-31T00:00:00.000Z');

function client(count = 1) {
  return {
    salesCommission: { updateMany: jest.fn().mockResolvedValue({ count }) },
    payrollCommissionItem: {
      findMany: jest.fn().mockResolvedValue([{ id: 'i-1' }, { id: 'i-2' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

describe('revertCommissionPayment — undo a payroll payment with a status CAS', () => {
  it('PAID → APPROVED, paidAt / paidAmount cleared, CAS on status PAID', async () => {
    const tx = client();
    expect(await revertCommissionPayment(tx as never, { id: 'c1', status: 'PAID', paidAt: PAID_AT })).toBe(true);
    expect(tx.salesCommission.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'PAID' },
      data: { status: 'APPROVED', paidAt: null, paidAmount: null },
    });
  });

  it('CLAWED_BACK with paidAt → paidAt / paidAmount / clawbackAmount cleared (unpaid 100% = nothing to deduct), status kept', async () => {
    const tx = client();
    expect(await revertCommissionPayment(tx as never, { id: 'c2', status: 'CLAWED_BACK', paidAt: PAID_AT })).toBe(true);
    expect(tx.salesCommission.updateMany).toHaveBeenCalledWith({
      where: { id: 'c2', status: 'CLAWED_BACK', paidAt: { not: null } },
      data: { paidAt: null, paidAmount: null, clawbackAmount: null },
    });
  });

  it('PARTIALLY_CLAWED_BACK is left alone by default (the void path refuses it first) and un-paid only with partial: unpay (wipe CLI), clawbackAmount kept', async () => {
    const tx = client();
    expect(await revertCommissionPayment(tx as never, { id: 'c3', status: 'PARTIALLY_CLAWED_BACK', paidAt: PAID_AT })).toBe(false);
    expect(tx.salesCommission.updateMany).not.toHaveBeenCalled();

    expect(await revertCommissionPayment(tx as never, { id: 'c3', status: 'PARTIALLY_CLAWED_BACK', paidAt: PAID_AT }, { partial: 'unpay' })).toBe(true);
    expect(tx.salesCommission.updateMany).toHaveBeenCalledWith({
      where: { id: 'c3', status: 'PARTIALLY_CLAWED_BACK', paidAt: { not: null } },
      data: { paidAt: null, paidAmount: null },
    });
  });

  it.each([
    ['APPROVED', PAID_AT],
    ['PENDING', null],
    ['CLAWED_BACK', null],
  ] as const)('%s (paidAt %s) → nothing written', async (status, paidAt) => {
    const tx = client();
    expect(await revertCommissionPayment(tx as never, { id: 'c4', status, paidAt })).toBe(false);
    expect(tx.salesCommission.updateMany).not.toHaveBeenCalled();
  });

  it.each(['PAID', 'CLAWED_BACK'] as const)('%s: the row changed since it was read (CAS count 0) → 409, never skipped silently', async (status) => {
    const tx = client(0);
    const err = await revertCommissionPayment(tx as never, { id: 'c5', status, paidAt: PAID_AT }).then(
      () => { throw new Error('expected a 409'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe('สถานะค่าคอมเปลี่ยนแล้ว กรุณาตรวจใหม่');
  });
});

describe('releaseCommissionItems — release every live item of one document', () => {
  it('reads live items of the document (releasedAt null) and stamps releasedAt on exactly those, returning their ids', async () => {
    const tx = client();
    const now = new Date('2026-11-03T03:00:00.000Z');
    expect(await releaseCommissionItems(tx as never, 'doc-1', now)).toEqual(['i-1', 'i-2']);
    expect(tx.payrollCommissionItem.findMany).toHaveBeenCalledWith({
      where: { releasedAt: null, payrollLine: { payroll: { documentId: 'doc-1' } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(tx.payrollCommissionItem.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['i-1', 'i-2'] }, releasedAt: null }, data: { releasedAt: now } });
  });

  it('no live items → no write, []', async () => {
    const tx = client();
    tx.payrollCommissionItem.findMany.mockResolvedValue([]);
    expect(await releaseCommissionItems(tx as never, 'doc-2', new Date())).toEqual([]);
    expect(tx.payrollCommissionItem.updateMany).not.toHaveBeenCalled();
  });
});
