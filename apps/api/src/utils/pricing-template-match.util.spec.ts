import { Prisma } from '@prisma/client';
import { findPricingTemplate, pickPricingTemplate, positiveDecimal } from './pricing-template-match.util';

const D = (n: string) => new Prisma.Decimal(n);
const ROW = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW' as const,
  hasWarranty: false,
  deviceOrigin: 'UNSPECIFIED' as const,
  ...over,
});
const KEY = {
  brand: 'apple ',
  model: 'IPHONE 15',
  storage: '128 GB',
  category: 'PHONE_NEW' as const,
  hasWarranty: null,
  deviceOrigin: null,
};

describe('pickPricingTemplate', () => {
  it('ยี่ห้อ/รุ่นไม่สนตัวพิมพ์และช่องว่าง · ความจุ "128 GB" = "128GB" · ต้องหมวดเดียวกัน', () => {
    const rows = [ROW({ id: 'used', category: 'PHONE_USED' }), ROW({ id: 'new' })];
    expect(pickPricingTemplate(rows, KEY)?.id).toBe('new');
  });

  it('ไม่มีแถวความจุตรง → ใช้แถวความจุว่าง', () => {
    expect(pickPricingTemplate([ROW({ id: 'blank', storage: '' })], KEY)?.id).toBe('blank');
  });

  it('เครื่องนอกไม่มีแถวของตัวเอง → ถอยไปแถว "ไม่ระบุ" (สเปคข้อ 7.1)', () => {
    const rows = [ROW({ id: 'thai', deviceOrigin: 'THAI' }), ROW({ id: 'any' })];
    expect(pickPricingTemplate(rows, { ...KEY, deviceOrigin: 'IMPORTED' })?.id).toBe('any');
  });

  it('มีแถวของที่มาเครื่องนั้น → ใช้ก่อนแถว "ไม่ระบุ"', () => {
    const rows = [ROW({ id: 'any' }), ROW({ id: 'thai', deviceOrigin: 'THAI' })];
    expect(pickPricingTemplate(rows, { ...KEY, deviceOrigin: 'THAI' })?.id).toBe('thai');
  });

  it('เครื่องยังไม่ระบุที่มา ไม่หยิบแถวเครื่องไทย/นอก', () => {
    expect(pickPricingTemplate([ROW({ deviceOrigin: 'THAI' })], KEY)).toBeNull();
  });

  it('มือ 2 รู้สถานะประกัน → แถวที่ตรงเท่านั้น · ไม่รู้ → แถว "ไม่มีประกัน"', () => {
    const rows = [
      ROW({ id: 'no', category: 'PHONE_USED', hasWarranty: false }),
      ROW({ id: 'yes', category: 'PHONE_USED', hasWarranty: true }),
    ];
    const used = { ...KEY, category: 'PHONE_USED' as const };
    expect(pickPricingTemplate(rows, { ...used, hasWarranty: true })?.id).toBe('yes');
    expect(pickPricingTemplate(rows, { ...used, hasWarranty: null })?.id).toBe('no');
  });
});

describe('findPricingTemplate', () => {
  it('ไม่มียี่ห้อหรือรุ่น → null โดยไม่อ่านฐานข้อมูล', async () => {
    const tx = { pricingTemplate: { findMany: jest.fn() } };
    expect(await findPricingTemplate(tx as never, { ...KEY, brand: '' })).toBeNull();
    expect(tx.pricingTemplate.findMany).not.toHaveBeenCalled();
  });

  it('อ่านเฉพาะแถวที่เปิดใช้ ของที่มาเครื่องนั้น + "ไม่ระบุ" เรียง hasWarranty แล้ว createdAt', async () => {
    const tx = { pricingTemplate: { findMany: jest.fn().mockResolvedValue([ROW()]) } };
    await findPricingTemplate(tx as never, { ...KEY, deviceOrigin: 'THAI' });
    const args = tx.pricingTemplate.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      isActive: true,
      deletedAt: null,
      category: 'PHONE_NEW',
      deviceOrigin: { in: ['THAI', 'UNSPECIFIED'] },
    });
    expect(args.orderBy).toEqual([{ hasWarranty: 'asc' }, { createdAt: 'asc' }]);
  });
});

describe('positiveDecimal', () => {
  it('ค่าบวกเท่านั้น', () => {
    expect(positiveDecimal(D('26500'))?.toString()).toBe('26500');
    expect(positiveDecimal('0')).toBeNull();
    expect(positiveDecimal(null)).toBeNull();
    expect(positiveDecimal(undefined)).toBeNull();
  });
});
