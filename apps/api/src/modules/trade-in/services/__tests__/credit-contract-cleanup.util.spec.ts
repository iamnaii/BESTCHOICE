import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cleanupCreditContractSale } from '../credit-contract-cleanup.util';

const D = (v: number | string) => new Prisma.Decimal(v);
const asTx = (tx: unknown) => tx as Prisma.TransactionClient;

/** สแนปช็อตเครดิตเทิร์นที่ถูกรูปแบบ (`creditSnapshot` ตรวจรูปแบบ + ยอดรวม) */
const SNAPSHOT = {
  version: 1, redemptionId: 'red-1', tradeInId: 'ti-1',
  baseAmount: '5000.00', bonusAmount: '0.00', cashDownAmount: '0.00', totalDownAmount: '5000.00',
};
const CONTRACT = { id: 'ct-1', status: 'DRAFT', tradeInCreditSnapshot: SNAPSHOT, bundleProductIds: [] };
const PAID_AT = new Date('2026-09-30T05:00:00Z');

const commission = (o: Record<string, unknown> = {}) => ({
  id: 'cm-1', status: 'PENDING', salespersonId: 'sp1', period: '2026-09',
  createdAt: new Date('2026-09-20T05:00:00Z'), commissionAmount: D('435'), paidAt: null, paidAmount: null, ...o,
});

function build(commissions: unknown[], payouts: unknown[] = []) {
  return {
    sale: {
      findMany: jest.fn().mockResolvedValue([{ id: 's-1', onlineOrderId: null, bundleProductIds: [] }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    booking: { findFirst: jest.fn().mockResolvedValue(null) },
    financeReceivable: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    interCompanyTransaction: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    interCoSettlementItem: { findFirst: jest.fn().mockResolvedValue(null) },
    salesCommission: { findMany: jest.fn().mockResolvedValue(commissions), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    commissionPayout: { findMany: jest.fn().mockResolvedValue(payouts), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

describe('cleanupCreditContractSale — commissions on a returned trade-in credit sale', () => {
  it('claws back a PAID commission (CLAWED_BACK, clawbackAmount = paidAmount) instead of refusing the credit return', async () => {
    const tx = build([commission({ status: 'PAID', paidAt: PAID_AT, paidAmount: D('435') })]);
    await expect(cleanupCreditContractSale(asTx(tx), CONTRACT, 'u-owner', 'ยกเลิกสัญญาใช้เครดิตเทิร์น')).resolves.toBeUndefined();

    expect(tx.salesCommission.updateMany).toHaveBeenCalledTimes(1);
    const write = tx.salesCommission.updateMany.mock.calls[0][0];
    expect(write.where).toEqual({ id: 'cm-1', status: 'PAID' });
    expect(write.data).toEqual({
      status: 'CLAWED_BACK', clawbackAmount: expect.any(Prisma.Decimal), clawbackPercent: 100,
      clawbackAt: expect.any(Date), clawbackReason: 'ยกเลิกสัญญาใช้เครดิตเทิร์น',
    });
    expect(write.data.clawbackAmount.toFixed(2)).toBe('435.00');
    // ใบขายถูกยกเลิกตามเดิม
    expect(tx.sale.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['s-1'] } } }));
  });

  it('unpaid PENDING commission → CLAWED_BACK with clawbackAmount null (same helper)', async () => {
    const tx = build([commission()]);
    await cleanupCreditContractSale(asTx(tx), CONTRACT, 'u-owner', 'r');
    const write = tx.salesCommission.updateMany.mock.calls[0][0];
    expect(write.where).toEqual({ id: 'cm-1', status: 'PENDING' });
    expect(write.data.clawbackAmount).toBeNull();
  });

  it('still refuses when a covering legacy payout round is APPROVED/PAID — and writes no commission', async () => {
    const tx = build([commission({ status: 'PAID', paidAt: PAID_AT, paidAmount: D('435') })], [
      { id: 'po-1', status: 'APPROVED', salespersonId: 'sp1', period: '2026-09', generatedAt: new Date('2026-09-25T00:00:00Z') },
    ]);
    await expect(cleanupCreditContractSale(asTx(tx), CONTRACT, 'u-owner', 'r')).rejects.toThrow(/รอบจ่าย/);
    expect(tx.salesCommission.updateMany).not.toHaveBeenCalled();
    expect(tx.sale.updateMany).not.toHaveBeenCalled();
  });

  it('soft-deletes a covering DRAFT round; a round generated before the commission is not covering (shared cover rule)', async () => {
    const tx = build([commission()], [
      { id: 'po-draft', status: 'DRAFT', salespersonId: 'sp1', period: '2026-09', generatedAt: new Date('2026-09-25T00:00:00Z') },
      { id: 'po-before', status: 'APPROVED', salespersonId: 'sp1', period: '2026-09', generatedAt: new Date('2026-09-19T00:00:00Z') },
    ]);
    await cleanupCreditContractSale(asTx(tx), CONTRACT, 'u-owner', 'r');
    expect(tx.commissionPayout.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.commissionPayout.updateMany.mock.calls[0][0].where).toEqual({ id: 'po-draft', status: 'DRAFT', deletedAt: null });
  });

  it('a commission that changed status since it was read → 409 สถานะค่าคอมเปลี่ยนแล้ว', async () => {
    const tx = build([commission({ status: 'APPROVED' })]);
    tx.salesCommission.updateMany.mockResolvedValue({ count: 0 });
    await expect(cleanupCreditContractSale(asTx(tx), CONTRACT, 'u-owner', 'r')).rejects.toThrow(
      new ConflictException('สถานะค่าคอมเปลี่ยนแล้ว กรุณาตรวจใหม่'),
    );
    expect(tx.sale.updateMany).not.toHaveBeenCalled();
  });

  it('contract cancellation (commissionHandledByCaller) leaves commissions to clawbackContractCommission', async () => {
    const tx = build([commission({ status: 'PAID', paidAt: PAID_AT, paidAmount: D('435') })]);
    await cleanupCreditContractSale(asTx(tx), CONTRACT, 'u-owner', 'r', { commissionHandledByCaller: true });
    expect(tx.salesCommission.findMany).not.toHaveBeenCalled();
    expect(tx.salesCommission.updateMany).not.toHaveBeenCalled();
  });
});
