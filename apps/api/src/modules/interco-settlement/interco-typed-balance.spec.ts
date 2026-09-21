import { Prisma } from '@prisma/client';
import {
  ALL_DEDUCTION_COLUMNS,
  DEVICE_RETURN_DEDUCTION_COLUMNS,
  postedDeductionsByContract,
} from './interco-typed-balance';

/**
 * `postedDeductionsByContract` — export ระดับ module (ใบรับเครื่องคืน 2026-09-20): ผู้เรียก =
 * IntercoPendingService (สองคิว) + Phase 2 RepossessionsService.findAll (deviceReturnOutstanding).
 * ที่นี่ปักเฉพาะตรรกะ "รวมเฉพาะคอลัมน์ที่ขอ" + where/select ผ่าน client mock.
 */
describe('postedDeductionsByContract (interco-typed-balance)', () => {
  const D = (v: number) => new Prisma.Decimal(v);
  const items = [
    { contractId: 'c-1', swapCreditAmount: D(8000), recallAmount: D(0), deviceReturnAmount: D(0) },
    { contractId: 'c-1', swapCreditAmount: D(0), recallAmount: D(0), deviceReturnAmount: D(3000) },
    { contractId: 'c-2', swapCreditAmount: D(0), recallAmount: D(11000), deviceReturnAmount: D(0) },
  ];
  const clientWith = (rows: typeof items) => {
    const findMany = jest.fn().mockResolvedValue(rows);
    return { client: { interCoSettlementItem: { findMany } } as never, findMany };
  };

  it('ALL_DEDUCTION_COLUMNS (คิว recall): รวมสามคอลัมน์ต่อสัญญา + where/select รูปเดียว', async () => {
    const { client, findMany } = clientWith(items);
    const map = await postedDeductionsByContract(client, ['c-1', 'c-2'], ALL_DEDUCTION_COLUMNS);
    expect(map.get('c-1')!.toString()).toBe('11000');
    expect(map.get('c-2')!.toString()).toBe('11000');
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      contractId: { in: ['c-1', 'c-2'] },
      deletedAt: null,
      batch: { status: 'POSTED', deletedAt: null },
    });
    expect(args.select).toEqual({
      contractId: true,
      swapCreditAmount: true,
      recallAmount: true,
      deviceReturnAmount: true,
    });
  });

  it('DEVICE_RETURN_DEDUCTION_COLUMNS (คิวค่าเครื่องคืน / Phase 2 findAll): รวมเฉพาะ deviceReturnAmount — เครดิตสวอป/เรียกคืนไม่นับ', async () => {
    const { client } = clientWith(items);
    const map = await postedDeductionsByContract(
      client,
      ['c-1', 'c-2'],
      DEVICE_RETURN_DEDUCTION_COLUMNS,
    );
    expect(map.get('c-1')!.toString()).toBe('3000');
    expect(map.get('c-2')!.toString()).toBe('0');
  });

  it('สัญญาที่ไม่มี item ใน batch POSTED = ไม่มี key (ผู้เรียกใช้ `?? 0`)', async () => {
    const { client } = clientWith([]);
    const map = await postedDeductionsByContract(client, ['c-9'], ALL_DEDUCTION_COLUMNS);
    expect(map.size).toBe(0);
    expect(map.get('c-9')).toBeUndefined();
  });

  it('ค่าคงที่สองตัวเป็นแหล่งเดียวของสูตร: ALL = ทั้งสาม, DEVICE_RETURN = คอลัมน์เดียว', () => {
    expect([...ALL_DEDUCTION_COLUMNS]).toEqual([
      'swapCreditAmount',
      'recallAmount',
      'deviceReturnAmount',
    ]);
    expect([...DEVICE_RETURN_DEDUCTION_COLUMNS]).toEqual(['deviceReturnAmount']);
  });
});
