import { Prisma } from '@prisma/client';
import { loadTemplateTerms } from './pricing-template-terms.util';

const D = (n: string) => new Prisma.Decimal(n);
const TEMPLATE = (over: Record<string, unknown> = {}) => ({
  id: 't',
  brand: 'Apple',
  model: 'iPhone 17 Pro',
  storage: '256GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  deviceOrigin: 'UNSPECIFIED',
  installmentBestchoicePrice: D('49900'),
  rate1TermMonths: 12,
  rate1DownPayment: D('15000'),
  rate2TermMonths: null,
  ...over,
});
const UNIT = (id: string, over: Record<string, unknown> = {}): Parameters<typeof loadTemplateTerms>[1][number] => ({
  id,
  brand: 'Apple',
  model: 'iPhone 17 Pro',
  storage: '256GB',
  category: 'PHONE_NEW',
  deviceOrigin: 'THAI',
  warrantyExpired: null,
  warrantyExpireDate: null,
  ...over,
}) as never;

describe('loadTemplateTerms — เงื่อนไขผ่อนของราคากลางต่อเครื่อง (ตัวเลือกแถวเดียวกับตอนสร้างเครื่อง)', () => {
  it('คืนงวด/ดาวน์ของแถวที่เลือก (Decimal เป็น string) · อ่านแถวราคากลางครั้งเดียวต่อชุด', async () => {
    const findMany = jest.fn().mockResolvedValue([
      TEMPLATE({ id: 'u-no', category: 'PHONE_USED', hasWarranty: false, rate1DownPayment: D('9000') }),
      TEMPLATE({ id: 'u-w', category: 'PHONE_USED', hasWarranty: true, rate1DownPayment: D('9500') }),
      TEMPLATE(),
    ]);
    const terms = await loadTemplateTerms({ pricingTemplate: { findMany } } as never, [
      UNIT('new'),
      UNIT('used-w', { category: 'PHONE_USED', warrantyExpired: false }),
      UNIT('acc', { category: 'ACCESSORY' }),
      UNIT('other', { model: 'Galaxy S24', brand: 'Samsung' }),
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isActive: true, deletedAt: null });
    expect(where.OR).toHaveLength(3); // ไม่อ่านแถวของอุปกรณ์เสริม
    expect(terms.get('new')).toEqual({ bcPrice: '49900', rate1TermMonths: 12, rate1DownPayment: '15000', rate2TermMonths: null });
    expect(terms.get('used-w')?.rate1DownPayment).toBe('9500');
    expect(terms.get('acc')).toBeNull();
    expect(terms.get('other')).toBeNull();
  });

  it('ไม่มีเครื่องที่หาราคากลางได้ → ไม่ยิงฐานข้อมูล', async () => {
    const findMany = jest.fn();
    const terms = await loadTemplateTerms({ pricingTemplate: { findMany } } as never, [UNIT('acc', { category: 'ACCESSORY' })]);
    expect(findMany).not.toHaveBeenCalled();
    expect(terms.get('acc')).toBeNull();
  });
});
