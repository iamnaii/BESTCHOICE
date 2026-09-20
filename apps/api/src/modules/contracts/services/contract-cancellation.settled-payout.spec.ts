import { Prisma } from '@prisma/client';
import { settledPayoutByContract } from './contract-cancellation.service';

/**
 * `settledPayoutByContract` = แหล่งเดียวของ C-2 detect (approveCancellation / listPendingCancellations /
 * exchange-cancel). `settledDeductions` ต้องเป็นสูตรเดียวกับ `totalDeduction` ของ batch —
 * ตั้งแต่ใบรับเครื่องคืน 2026-09-20 รวม `deviceReturnAmount` (แถว SETTLEMENT = 0 เสมอ จึงเป็น
 * no-op เชิงตัวเลข แต่กัน "สำเนาสูตรที่สอง").
 */
describe('settledPayoutByContract — Σ deduction รวม deviceReturnAmount (byte-parity กับ totalDeduction)', () => {
  const D = (v: number) => new Prisma.Decimal(v);

  it('รวม swapCredit + recall + deviceReturn และเลือกเฉพาะ item SETTLEMENT ใน batch POSTED', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        contractId: 'c-1',
        financedGl: D(10000),
        commissionGl: D(1000),
        shopFinancedGl: D(10000),
        shopCommissionGl: D(1000),
        swapCreditAmount: D(2000),
        recallAmount: D(0),
        deviceReturnAmount: D(500),
        batch: { batchNumber: 'IC-20260920-0001' },
      },
    ]);
    const client = { interCoSettlementItem: { findMany } } as unknown as Prisma.TransactionClient;

    const map = await settledPayoutByContract(client, ['c-1']);
    const entry = map.get('c-1')!;
    expect(entry.settledTotal.toString()).toBe('11000');
    expect(entry.settledShopTotal.toString()).toBe('11000');
    expect(entry.settledDeductions.toString()).toBe('2500');
    expect(entry.batchNumbers).toEqual(['IC-20260920-0001']);

    const where = findMany.mock.calls[0][0].where;
    expect(where.itemType).toBe('SETTLEMENT');
    expect(where.batch).toEqual({ status: 'POSTED', deletedAt: null });
  });

  it('รายการว่าง → Map ว่างโดยไม่ query', async () => {
    const findMany = jest.fn();
    const client = { interCoSettlementItem: { findMany } } as unknown as Prisma.TransactionClient;
    expect((await settledPayoutByContract(client, [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
