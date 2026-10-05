import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ShopStockWriteOffTemplate } from '../cpa-templates/shop-stock-writeoff.template';

/**
 * ตัดสินค้า สูญหาย/ตัดจำหน่าย (ก้อน 3 · ฝ่ายบัญชี ข6 2026-09-29): Dr S53-1102 / Cr S11-200x ต้นทุนเครื่อง
 * พบของคืน = กลับรายการใบเดิม (ข6) · spec อยู่ใต้ journal/__tests__ เพราะ jest ไม่อ่าน spec ใต้ cpa-templates/
 */
function build() {
  const createAndPost = jest.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202610-00001' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), update: jest.fn() },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = { $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companies: any = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co') };
  const template = new ShopStockWriteOffTemplate({ createAndPost } as never, prisma, companies);
  return { template, createAndPost, tx };
}

const base = {
  idempotencyKey: 'shop-stock-writeoff:adj-1',
  adjustmentId: 'adj-1',
  requestNumber: 'SA-20261005-0001',
  productId: 'p1',
  productName: 'iPhone 15 128GB',
  imeiSerial: '350000000000001',
  reason: 'LOST' as const,
  inventoryAccountCode: 'S11-2001' as const,
  amount: new Decimal('24900'),
  branchId: 'b1',
};

describe('ShopStockWriteOffTemplate.execute', () => {
  it('LOST → Dr S53-1102 / Cr S11-2001 ต้นทุน · companyId SHOP · metadata ไม่มี contractId/saleId', async () => {
    const { template, createAndPost } = build();
    const out = await template.execute(base);
    expect(out).toEqual({ entryNo: 'JE-202610-00001', journalEntryId: 'je-1' });
    const arg = createAndPost.mock.calls[0][0];
    expect(arg.lines).toHaveLength(2);
    expect(arg.lines[0]).toMatchObject({ accountCode: 'S53-1102' });
    expect(arg.lines[0].dr.toFixed(2)).toBe('24900.00');
    expect(arg.lines[0].cr.toFixed(2)).toBe('0.00');
    expect(arg.lines[1]).toMatchObject({ accountCode: 'S11-2001' });
    expect(arg.lines[1].dr.toFixed(2)).toBe('0.00');
    expect(arg.lines[1].cr.toFixed(2)).toBe('24900.00');
    expect(arg.companyId).toBe('shop-co');
    expect(arg.reference).toBe('sa:adj-1');
    expect(arg.metadata).toMatchObject({
      tag: 'SHOP_STOCK_WRITEOFF',
      flow: 'shop-stock-writeoff',
      idempotencyKey: 'shop-stock-writeoff:adj-1',
      adjustmentId: 'adj-1',
      requestNumber: 'SA-20261005-0001',
      productId: 'p1',
      reason: 'LOST',
      inventoryAccountCode: 'S11-2001',
      companyCode: 'SHOP',
      amount: '24900.00',
    });
    expect(arg.metadata).not.toHaveProperty('contractId');
    expect(arg.metadata).not.toHaveProperty('saleId');
    expect(createAndPost.mock.calls[0][1]).toBeDefined(); // ส่ง tx ต่อ
  });

  it('WRITE_OFF ลงบัญชีสินค้าตามประเภทที่ส่งมา (S11-2003 อุปกรณ์เสริม)', async () => {
    const { template, createAndPost } = build();
    await template.execute({ ...base, reason: 'WRITE_OFF', inventoryAccountCode: 'S11-2003', amount: new Decimal('190') });
    const arg = createAndPost.mock.calls[0][0];
    expect(arg.lines[1]).toMatchObject({ accountCode: 'S11-2003' });
    expect(arg.lines[1].cr.toFixed(2)).toBe('190.00');
    expect(arg.metadata).toMatchObject({ reason: 'WRITE_OFF', amount: '190.00' });
  });

  it('idempotent — มี JE เดิมแล้วคืนใบเดิม ไม่โพสต์ซ้ำ', async () => {
    const { template, createAndPost, tx } = build();
    tx.journalEntry.findFirst.mockResolvedValue({ id: 'je-old', entryNumber: 'JE-OLD' });
    await expect(template.execute(base)).resolves.toEqual({ entryNo: 'JE-OLD', journalEntryId: 'je-old' });
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('amount ≤ 0 หรือบัญชีสินค้าไม่ใช่ S11-200x → BadRequest ไม่โพสต์', async () => {
    const { template, createAndPost } = build();
    await expect(template.execute({ ...base, amount: new Decimal(0) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      template.execute({ ...base, inventoryAccountCode: 'S21-1101' as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createAndPost).not.toHaveBeenCalled();
  });
});

describe('ShopStockWriteOffTemplate.reverse', () => {
  const original = {
    id: 'je-1',
    entryNumber: 'JE-202610-00001',
    metadata: {
      tag: 'SHOP_STOCK_WRITEOFF',
      flow: 'shop-stock-writeoff',
      adjustmentId: 'adj-1',
      productId: 'p1',
      reason: 'LOST',
      amount: '24900.00',
    },
    lines: [
      { accountCode: 'S53-1102', debit: new Decimal('24900'), credit: new Decimal(0), description: 'สินค้าสูญหาย' },
      { accountCode: 'S11-2001', debit: new Decimal(0), credit: new Decimal('24900'), description: 'สินค้าคงคลัง' },
    ],
  };

  it('กลับทุกบรรทัดของใบเดิม (สลับ Dr/Cr) + stamp reversed/reversedByEntryNumber บนใบเดิม', async () => {
    const { template, createAndPost, tx } = build();
    tx.journalEntry.findUnique.mockResolvedValue(original);
    const out = await template.reverse({
      journalEntryId: 'je-1',
      idempotencyKey: 'shop-stock-writeoff-reversal:adj-9',
      foundAdjustmentId: 'adj-9',
      reason: 'พบของคืน SA-20261006-0002',
    });
    expect(out).toEqual({ entryNo: 'JE-202610-00001', journalEntryId: 'je-1' });
    const arg = createAndPost.mock.calls[0][0];
    expect(arg.lines[0]).toMatchObject({ accountCode: 'S53-1102' });
    expect(arg.lines[0].dr.toFixed(2)).toBe('0.00');
    expect(arg.lines[0].cr.toFixed(2)).toBe('24900.00');
    expect(arg.lines[1]).toMatchObject({ accountCode: 'S11-2001' });
    expect(arg.lines[1].dr.toFixed(2)).toBe('24900.00');
    expect(arg.lines[1].cr.toFixed(2)).toBe('0.00');
    expect(arg.reference).toBe('sa:adj-9:found');
    expect(arg.metadata).toMatchObject({
      tag: 'SHOP_STOCK_WRITEOFF_REVERSAL',
      flow: 'shop-stock-writeoff',
      idempotencyKey: 'shop-stock-writeoff-reversal:adj-9',
      reversesEntryId: 'je-1',
      reversesEntryNo: 'JE-202610-00001',
      foundAdjustmentId: 'adj-9',
      adjustmentId: 'adj-1',
      productId: 'p1',
      companyCode: 'SHOP',
    });
    expect(tx.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'je-1' },
        data: { metadata: expect.objectContaining({ reversed: true, reversedByEntryNumber: 'JE-202610-00001' }) },
      }),
    );
  });

  it('ใบเดิมไม่ใช่ tag SHOP_STOCK_WRITEOFF → BadRequest', async () => {
    const { template, tx, createAndPost } = build();
    tx.journalEntry.findUnique.mockResolvedValue({ ...original, metadata: { tag: 'OTHER' } });
    await expect(
      template.reverse({ journalEntryId: 'je-1', idempotencyKey: 'k', foundAdjustmentId: 'a', reason: 'r' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('ใบเดิมถูกกลับรายการไปแล้ว → BadRequest ไม่กลับซ้ำ', async () => {
    const { template, tx, createAndPost } = build();
    tx.journalEntry.findUnique.mockResolvedValue({ ...original, metadata: { ...original.metadata, reversed: true } });
    await expect(
      template.reverse({ journalEntryId: 'je-1', idempotencyKey: 'k2', foundAdjustmentId: 'a', reason: 'r' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('idempotent — มีใบกลับรายการแล้วคืนใบเดิม', async () => {
    const { template, tx, createAndPost } = build();
    tx.journalEntry.findFirst.mockResolvedValue({ id: 'je-rev', entryNumber: 'JE-REV' });
    await expect(
      template.reverse({ journalEntryId: 'je-1', idempotencyKey: 'k3', foundAdjustmentId: 'a', reason: 'r' }),
    ).resolves.toEqual({ entryNo: 'JE-REV', journalEntryId: 'je-rev' });
    expect(createAndPost).not.toHaveBeenCalled();
  });
});
