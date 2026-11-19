import { Prisma } from '@prisma/client';
import { autofillProductPriceFromTemplate } from './product-price-autofill.util';

const D = (n: string) => new Prisma.Decimal(n);

const TPL = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  deviceOrigin: 'UNSPECIFIED',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  cashPrice: D('28900'),
  installmentBestchoicePrice: D('31900'),
  ...over,
});

function makeTx(templates: unknown[]) {
  return {
    pricingTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
    product: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    productPrice: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'row-1' }),
      update: jest.fn().mockResolvedValue({ id: 'row-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

const BASE = {
  productId: 'p1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128 GB',
  category: 'PHONE_NEW' as const,
  hasWarranty: null,
  currentCashPrice: null,
};

describe('autofillProductPriceFromTemplate', () => {
  it('มีราคาอยู่แล้ว → ไม่ทับ', async () => {
    const tx = makeTx([TPL()]);
    const r = await autofillProductPriceFromTemplate(tx as never, {
      ...BASE,
      currentCashPrice: D('27000'),
    });
    expect(r).toEqual({ filled: false, reason: 'ALREADY_PRICED' });
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('normalize ความจุ "128 GB" ↔ "128GB" แล้วเติม cashPrice', async () => {
    const tx = makeTx([TPL()]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r.filled).toBe(true);
    expect(r.reason).toBe('FILLED');
    const data = tx.product.update.mock.calls[0][0].data;
    expect(data.cashPrice.toString()).toBe('28900');
    expect(data.priceAutofilledAt).toBeInstanceOf(Date);
  });

  it('ไม่มีแถวความจุตรง → ใช้แถว storage ว่าง (fallback)', async () => {
    const tx = makeTx([TPL({ storage: '', cashPrice: D('27500') })]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r.cashPrice?.toString()).toBe('27500');
  });

  // เครื่องเทิร์นส่ง hasWarranty: null เสมอ และเทมเพลตมาตรฐานมี 2 แถวต่อรุ่นมือสองพอดี
  // → ถ้าข้าม เครื่องมือสองเกือบทุกเครื่องจะไม่ได้ราคา; เลือกแถว "ไม่มีประกัน" (ถูกกว่า)
  it('PHONE_USED + ไม่รู้ประกัน + มีทั้ง 2 แถว → ใช้แถวไม่มีประกัน (ราคาต่ำกว่า) + log', async () => {
    const log = jest.fn();
    const tx = makeTx([
      TPL({ id: 'a', category: 'PHONE_USED', hasWarranty: false, cashPrice: D('20000') }),
      TPL({ id: 'b', category: 'PHONE_USED', hasWarranty: true, cashPrice: D('22000') }),
    ]);
    const r = await autofillProductPriceFromTemplate(
      tx as never,
      { ...BASE, category: 'PHONE_USED', hasWarranty: null },
      { warn: jest.fn(), log },
    );
    expect(r.filled).toBe(true);
    expect(r.templateId).toBe('a');
    expect(r.cashPrice?.toString()).toBe('20000');
    expect(log).toHaveBeenCalled();
  });

  it('PHONE_USED + ไม่รู้ประกัน + มีแถวเดียว → ใช้แถวนั้นได้', async () => {
    const tx = makeTx([TPL({ category: 'PHONE_USED', hasWarranty: true, cashPrice: D('22000') })]);
    const r = await autofillProductPriceFromTemplate(tx as never, {
      ...BASE,
      category: 'PHONE_USED',
      hasWarranty: null,
    });
    expect(r.cashPrice?.toString()).toBe('22000');
  });

  it('ไม่มีเทมเพลตเลย → NO_TEMPLATE', async () => {
    const tx = makeTx([]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r).toEqual({ filled: false, reason: 'NO_TEMPLATE' });
  });

  it('เทมเพลตราคา 0 → ZERO_PRICE ไม่เขียน', async () => {
    const tx = makeTx([TPL({ cashPrice: D('0') })]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r).toEqual({ filled: false, reason: 'ZERO_PRICE' });
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('เติมสำเร็จ → write-through สร้างแถว ProductPrice ด้วย', async () => {
    const tx = makeTx([TPL()]);
    await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(tx.productPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ label: 'ราคาเงินสด' }) }),
    );
  });

  it('ราคาผ่อน BESTCHOICE ของราคากลาง = ราคาเต็ม → เติม installmentPrice พร้อมเงินสดเสมอ ไม่อ่านค่าตั้งใด ๆ (สเปค 3.1)', async () => {
    const tx = makeTx([TPL()]);
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r).toMatchObject({ filled: true, reason: 'FILLED' });
    expect(r.installmentPrice?.toString()).toBe('31900');
    expect(tx.product.update.mock.calls[0][0].data.installmentPrice.toString()).toBe('31900');
    expect(tx.systemConfig.findFirst).not.toHaveBeenCalled();
  });

  it('มือ 2 ที่ราคาผ่อนต่ำกว่าเงินสด (ทุกรุ่นในชีต) ก็ยังเติมราคาผ่อน', async () => {
    const tx = makeTx([
      TPL({ category: 'PHONE_USED', hasWarranty: false, cashPrice: D('8900'), installmentBestchoicePrice: D('7000') }),
    ]);
    const r = await autofillProductPriceFromTemplate(tx as never, {
      ...BASE,
      category: 'PHONE_USED',
      hasWarranty: false,
    });
    expect(r.installmentPrice?.toString()).toBe('7000');
  });

  it('เครื่องไทยไม่มีแถวของตัวเอง → ใช้แถว "ไม่ระบุ" (สเปค 7.1)', async () => {
    const tx = makeTx([TPL({ id: 'u1', deviceOrigin: 'UNSPECIFIED' })]);
    const r = await autofillProductPriceFromTemplate(tx as never, { ...BASE, deviceOrigin: 'THAI' });
    expect(r.templateId).toBe('u1');
    expect(tx.pricingTemplate.findMany.mock.calls[0][0].where.deviceOrigin).toEqual({
      in: ['THAI', 'UNSPECIFIED'],
    });
  });

  it('มีทั้งแถวเครื่องไทยและ "ไม่ระบุ" → ใช้แถวเครื่องไทย', async () => {
    const tx = makeTx([
      TPL({ id: 'u1', deviceOrigin: 'UNSPECIFIED', cashPrice: D('28900') }),
      TPL({ id: 'th', deviceOrigin: 'THAI', cashPrice: D('29900') }),
    ]);
    const r = await autofillProductPriceFromTemplate(tx as never, { ...BASE, deviceOrigin: 'THAI' });
    expect(r.templateId).toBe('th');
    expect(r.cashPrice?.toString()).toBe('29900');
  });

  it('เครื่องที่ไม่ระบุที่มา → ค้นเฉพาะแถว "ไม่ระบุ"', async () => {
    const tx = makeTx([TPL()]);
    await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(tx.pricingTemplate.findMany.mock.calls[0][0].where.deviceOrigin).toEqual({ in: ['UNSPECIFIED'] });
  });
});
