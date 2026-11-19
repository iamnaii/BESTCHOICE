import { BadRequestException } from '@nestjs/common';
import { PricingTemplatesController } from './pricing-templates.controller';

describe('PricingTemplatesController.quotes', () => {
  const listQuotes = jest.fn().mockResolvedValue({ updatedAt: null, rows: [] });
  const controller = new PricingTemplatesController({} as never, { listQuotes } as never);
  beforeEach(() => listQuotes.mockClear());

  it('ค่าเริ่มต้น = มือ 1 · เครื่องไทย (สเปคข้อ 3.4)', async () => {
    await controller.quotes(undefined, undefined, undefined);
    expect(listQuotes).toHaveBeenCalledWith({ category: 'PHONE_NEW', origin: 'THAI', q: undefined });
  });

  it('ส่งตัวกรองต่อ และตัดคำค้นที่ยาวเกิน 80 ตัวอักษร', async () => {
    await controller.quotes('PHONE_USED', 'IMPORTED', 'x'.repeat(100));
    expect(listQuotes).toHaveBeenCalledWith({ category: 'PHONE_USED', origin: 'IMPORTED', q: 'x'.repeat(80) });
  });

  it('หมวด / ที่มาเครื่องผิด → 400', () => {
    expect(() => controller.quotes('ACCESSORY', 'THAI')).toThrow(BadRequestException);
    expect(() => controller.quotes('PHONE_NEW', 'UNSPECIFIED')).toThrow(BadRequestException);
  });
});
