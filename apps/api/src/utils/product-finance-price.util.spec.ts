import { Prisma } from '@prisma/client';
import {
  fillFinancePriceFromTemplate,
  resolveHasWarranty,
  syncFinancePriceRow,
  templateKeyOf,
} from './product-finance-price.util';

const D = (n: string) => new Prisma.Decimal(n);
const TEMPLATE = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  deviceOrigin: 'UNSPECIFIED',
  cashPrice: D('25900'),
  installmentBestchoicePrice: D('25900'),
  installmentFinancePrice: D('26500'),
  ...over,
});
const PRODUCT = {
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW' as const,
  deviceOrigin: 'THAI' as const,
  warrantyExpired: null,
  warrantyExpireDate: null,
};

function makeTx(templates: unknown[]) {
  return {
    pricingTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
    product: { update: jest.fn().mockResolvedValue({}) },
    productPrice: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'row-f' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('resolveHasWarranty / templateKeyOf', () => {
  it('ไม่ใช่มือ 2 = false · มือ 2 ตามช่องประกัน · ไม่รู้ = null', () => {
    expect(resolveHasWarranty({ category: 'PHONE_NEW', warrantyExpired: null, warrantyExpireDate: null })).toBe(false);
    expect(resolveHasWarranty({ category: 'PHONE_USED', warrantyExpired: true, warrantyExpireDate: null })).toBe(false);
    expect(resolveHasWarranty({ category: 'PHONE_USED', warrantyExpired: false, warrantyExpireDate: null })).toBe(true);
    expect(resolveHasWarranty({ category: 'PHONE_USED', warrantyExpired: null, warrantyExpireDate: null })).toBeNull();
  });

  it('key ของเครื่อง = ยี่ห้อ รุ่น ความจุ หมวด ที่มา + ประกัน', () => {
    expect(templateKeyOf(PRODUCT)).toEqual({
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      category: 'PHONE_NEW',
      deviceOrigin: 'THAI',
      hasWarranty: false,
    });
  });
});

describe('fillFinancePriceFromTemplate', () => {
  it('เจอราคากลาง (เครื่องไทย → ถอยไปแถว "ไม่ระบุ") → เขียนคอลัมน์ + แถว "ราคาผ่อนไฟแนนซ์" ที่ไม่เป็นค่าเริ่มต้น', async () => {
    const tx = makeTx([TEMPLATE()]);
    const price = await fillFinancePriceFromTemplate(tx as never, 'p1', templateKeyOf(PRODUCT));
    expect(price?.toString()).toBe('26500');
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { financePrice: D('26500') } });
    expect(tx.productPrice.create).toHaveBeenCalledWith({
      data: { productId: 'p1', label: 'ราคาผ่อนไฟแนนซ์', amount: D('26500'), isDefault: false },
    });
  });

  it('ไม่มีราคากลาง หรือราคาขาย GFIN = 0 → ไม่เขียนอะไร', async () => {
    for (const templates of [[], [TEMPLATE({ installmentFinancePrice: D('0') })]]) {
      const tx = makeTx(templates);
      expect(await fillFinancePriceFromTemplate(tx as never, 'p1', templateKeyOf(PRODUCT))).toBeNull();
      expect(tx.product.update).not.toHaveBeenCalled();
    }
  });
});

describe('syncFinancePriceRow', () => {
  it('null → ลบแถว "ราคาผ่อนไฟแนนซ์" ที่ไม่ใช่ค่าเริ่มต้นแบบ soft', async () => {
    const tx = makeTx([]);
    await syncFinancePriceRow(tx as never, 'p1', null);
    expect(tx.productPrice.updateMany).toHaveBeenCalledWith({
      where: { productId: 'p1', label: 'ราคาผ่อนไฟแนนซ์', isDefault: false, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
