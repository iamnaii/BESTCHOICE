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

  it('ส่ง ?q= ซ้ำ (Express ให้เป็น array) → 400 ไม่ใช่ 500 และไม่ค้น', () => {
    expect(() => controller.quotes('PHONE_NEW', 'THAI', ['a', 'b'] as unknown as string)).toThrow(
      BadRequestException,
    );
    expect(listQuotes).not.toHaveBeenCalled();
  });
});

describe('PricingTemplatesController.backfillFinancePrice dryRun', () => {
  const backfillFinancePrice = jest.fn().mockResolvedValue({ count: 0 });
  const controller = new PricingTemplatesController({ backfillFinancePrice } as never, {} as never);
  beforeEach(() => backfillFinancePrice.mockClear());

  it('เขียนจริงเฉพาะเมื่อไม่ส่ง หรือ dryRun=false', () => {
    controller.backfillFinancePrice(undefined, { id: 'u' });
    controller.backfillFinancePrice('false', { id: 'u' });
    controller.backfillFinancePrice('true', { id: 'u' });
    expect(backfillFinancePrice.mock.calls.map((c) => c[0].dryRun)).toEqual([false, false, true]);
  });

  it('ค่าอื่น เช่น dryRun=1 → 400 และไม่เขียน', () => {
    expect(() => controller.backfillFinancePrice('1', { id: 'u' })).toThrow(BadRequestException);
    expect(backfillFinancePrice).not.toHaveBeenCalled();
  });
});
