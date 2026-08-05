import { Prisma } from '@prisma/client';
import { autofillProductPriceFromTemplate } from './product-price-autofill.util';

const D = (n: string) => new Prisma.Decimal(n);

const TPL = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  cashPrice: D('28900'),
  installmentBestchoicePrice: D('2500'),
  ...over,
});

function makeTx(templates: unknown[], semantics: string | null = null) {
  return {
    pricingTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
    product: { update: jest.fn().mockResolvedValue({ id: 'p1' }) },
    productPrice: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'row-1' }),
      update: jest.fn().mockResolvedValue({ id: 'row-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    systemConfig: {
      findFirst: jest.fn().mockResolvedValue(semantics ? { value: semantics } : null),
    },
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

  it('semantics PER_MONTH (default) → ไม่เติม installmentPrice', async () => {
    const tx = makeTx([TPL()]);
    await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(tx.product.update.mock.calls[0][0].data).not.toHaveProperty('installmentPrice');
  });

  it('semantics TOTAL → เติม installmentPrice ด้วย', async () => {
    const tx = makeTx([TPL({ installmentBestchoicePrice: D('31900') })], 'TOTAL');
    const r = await autofillProductPriceFromTemplate(tx as never, BASE);
    expect(r.installmentPrice?.toString()).toBe('31900');
    expect(tx.product.update.mock.calls[0][0].data.installmentPrice.toString()).toBe('31900');
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

  it('semantics พิมพ์ผิด (เช่น "total ") → warn + ใช้ PER_MONTH ไม่เขียน installmentPrice', async () => {
    const warn = jest.fn();
    const tx = makeTx([TPL({ installmentBestchoicePrice: D('31900') })], 'TOTALL');
    const r = await autofillProductPriceFromTemplate(tx as never, BASE, { warn, log: jest.fn() });
    expect(r.filled).toBe(true);
    expect(r.installmentPrice).toBeUndefined();
    expect(tx.product.update.mock.calls[0][0].data).not.toHaveProperty('installmentPrice');
    expect(warn).toHaveBeenCalled();
  });

  // sanity guard: flag เป็น TOTAL แต่เลขต่ำกว่าราคาเงินสด = เกือบแน่ว่าเป็นค่างวดต่อเดือน
  // ปล่อยผ่านแล้วสัญญาจะคิดจาก 2,500 แทน 28,900 (installmentPrice ชนะทุกแถวหลัง Task 1)
  it('TOTAL แต่ราคาผ่อน < ราคาเงินสด → เติมเฉพาะเงินสด + reason INSTALLMENT_LOOKS_PER_MONTH', async () => {
    const warn = jest.fn();
    const tx = makeTx([TPL({ cashPrice: D('28900'), installmentBestchoicePrice: D('2500') })], 'TOTAL');
    const r = await autofillProductPriceFromTemplate(tx as never, BASE, { warn, log: jest.fn() });
    expect(r.filled).toBe(true);
    expect(r.reason).toBe('INSTALLMENT_LOOKS_PER_MONTH');
    expect(r.installmentPrice).toBeUndefined();
    expect(tx.product.update.mock.calls[0][0].data).not.toHaveProperty('installmentPrice');
    expect(warn).toHaveBeenCalled();
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
});
