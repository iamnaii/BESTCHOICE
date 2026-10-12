import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertCashReplacement, CASH_REPLACEMENT_MSG } from '../utils/assert-cash-replacement';

const OLD = { id: 'p-old', brand: 'Apple', model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED' };
const CUSTOMER = { name: 'สมชาย ใจดี', phone: '0812345678', addressCurrent: 'ลพบุรี' };
const NEW = {
  id: 'p-new',
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  imeiSerial: '359000000000002',
  costPrice: new Prisma.Decimal('10500.00'),
  category: 'PHONE_USED',
  status: 'IN_STOCK',
  branchId: 'b-1',
  deletedAt: null,
  name: 'iPhone 13 128GB',
  po: null,
};
const INPUT = { sale: { id: 's-1', productId: 'p-old', customerId: 'c-1' }, caseBranchId: 'b-1' };

function client(
  newProduct: Record<string, unknown> | null = NEW,
  oldProduct: Record<string, unknown> = OLD,
) {
  return {
    product: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'p-old' ? oldProduct : newProduct),
        ),
    },
    customer: { findUniqueOrThrow: jest.fn().mockResolvedValue(CUSTOMER) },
  };
}

describe('assertCashReplacement (PR 5 §3.3) — ด่านเครื่องทดแทนของเคสขายสด ใช้ทั้ง intake และ confirm', () => {
  it('ผ่านทุกข้อ → คืนเครื่องทดแทน (มี costPrice ให้ confirm ใช้)', async () => {
    const p = await assertCashReplacement(client() as never, INPUT, 'p-new');
    expect(p).toMatchObject({ id: 'p-new', costPrice: new Prisma.Decimal('10500.00') });
  });

  it.each([
    ['ไม่พบ/ถูกลบ', null, CASH_REPLACEMENT_MSG.NOT_FOUND],
    ['เครื่องเดิมของใบขายเอง', { ...NEW, id: 'p-old' }, CASH_REPLACEMENT_MSG.SAME_DEVICE],
    ['เครื่องใหม่ (PHONE_NEW)', { ...NEW, category: 'PHONE_NEW' }, CASH_REPLACEMENT_MSG.NOT_USED],
    ['ไม่ใช่ IN_STOCK', { ...NEW, status: 'SOLD_CASH' }, CASH_REPLACEMENT_MSG.NOT_IN_STOCK],
    ['คนละสาขากับเคส', { ...NEW, branchId: 'b-2' }, CASH_REPLACEMENT_MSG.WRONG_BRANCH],
    ['ความจุไม่ตรง', { ...NEW, storage: '256GB' }, CASH_REPLACEMENT_MSG.MODEL_MISMATCH],
  ])('%s → 400 %s', async (_label, product, msg) => {
    await expect(
      assertCashReplacement(
        client(product) as never,
        INPUT,
        product?.id === 'p-old' ? 'p-old' : 'p-new',
      ),
    ).rejects.toThrow(new BadRequestException(msg));
  });

  it('เครื่องเดิมของใบขายเป็นเครื่องใหม่ (PHONE_NEW) → 400 "เปลี่ยนรุ่นเดิมเฉพาะมือสอง" (คำตัดสินเจ้าของ ① — เส้น fromRepair ไม่ผ่าน computeOutcomes จึงต้องกันที่ด่านนี้)', async () => {
    await expect(
      assertCashReplacement(client(NEW, { ...OLD, category: 'PHONE_NEW' }) as never, INPUT, 'p-new'),
    ).rejects.toThrow(/เปลี่ยนรุ่นเดิมเฉพาะมือสอง/);
  });

  it('รั้วข้อมูลทดสอบ: ลูกค้าจริง + เครื่องทดสอบ (IMEI ขึ้นต้น TEST-) → โยนจาก assertSameTestSide', async () => {
    await expect(
      assertCashReplacement(client({ ...NEW, imeiSerial: 'TEST-0001' }) as never, INPUT, 'p-new'),
    ).rejects.toThrow(/เครื่องทดสอบระบบ/);
  });
});
