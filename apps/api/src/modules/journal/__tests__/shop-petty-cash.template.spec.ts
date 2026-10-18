/**
 * ShopPettyCashTemplate — รายการบัญชีสมุดหน้าร้านของเมนูเติม/คืนเงินสดย่อย S11-1106 (ข้อ 20.2 · 2026-10-18)
 * อยู่ใน journal/__tests__ เพราะ jest ของ api ข้าม spec ใต้ cpa-templates/ (ดู package.json testPathIgnorePatterns)
 */
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ShopPettyCashTemplate, ShopPettyCashInput } from '../cpa-templates/shop-petty-cash.template';

type Line = { accountCode: string; dr: Decimal; cr: Decimal };

function setup() {
  const journal = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-new', entryNumber: 'S-JV-2569-0007' }) };
  const tx = { journalEntry: { findFirst: jest.fn().mockResolvedValue(null) } };
  const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const companyResolver = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co') };
  const template = new ShopPettyCashTemplate(journal as never, prisma as never, companyResolver as never);
  const lastCall = () =>
    journal.createAndPost.mock.calls[0][0] as {
      lines: Line[];
      metadata: Record<string, unknown>;
      companyId: string;
      postedAt: Date;
      reference: string;
      description: string;
    };
  const asPairs = (lines: Line[]) => lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)]);
  return { journal, tx, template, lastCall, asPairs };
}

const base = (over: Partial<ShopPettyCashInput> = {}): ShopPettyCashInput => ({
  idempotencyKey: 'petty-cash:m1',
  kind: 'TOP_UP',
  movementId: 'm1',
  amount: new Decimal('10000'),
  bankAccountCode: 'S11-1202',
  postedAt: new Date('2026-10-18T17:00:00.000Z'),
  ...over,
});

describe('ShopPettyCashTemplate', () => {
  it('TOP_UP: Dr S11-1106 / Cr ธนาคารที่เลือก · metadata ครบ · ลงสมุด SHOP', async () => {
    const { template, lastCall, asPairs } = setup();
    const result = await template.execute(base());
    expect(result).toEqual({ entryNo: 'S-JV-2569-0007', journalEntryId: 'je-new' });
    const call = lastCall();
    expect(asPairs(call.lines)).toEqual([
      ['S11-1106', '10000.00', '0.00'],
      ['S11-1202', '0.00', '10000.00'],
    ]);
    expect(call.companyId).toBe('shop-co');
    expect(call.postedAt.toISOString()).toBe('2026-10-18T17:00:00.000Z');
    expect(call.reference).toBe('petty-cash:m1');
    expect(call.description).toContain('เติมเงินสดย่อย');
    expect(call.description).toContain('ธนาคารหน้าร้าน (จ่ายออก)');
    expect(call.metadata).toMatchObject({
      tag: 'SHOP_PETTY_CASH',
      flow: 'shop-petty-cash',
      idempotencyKey: 'petty-cash:m1',
      kind: 'TOP_UP',
      movementId: 'm1',
      bankAccountCode: 'S11-1202',
      companyCode: 'SHOP',
      amount: '10000.00',
    });
  });

  it('RETURN: Dr ธนาคารที่เลือก / Cr S11-1106', async () => {
    const { template, lastCall, asPairs } = setup();
    await template.execute(base({ kind: 'RETURN', bankAccountCode: 'S11-1201', amount: new Decimal('2500.50'), idempotencyKey: 'petty-cash:m2', movementId: 'm2' }));
    const call = lastCall();
    expect(asPairs(call.lines)).toEqual([
      ['S11-1201', '2500.50', '0.00'],
      ['S11-1106', '0.00', '2500.50'],
    ]);
    expect(call.description).toContain('คืนเงินสดย่อย');
    expect(call.description).toContain('ธนาคารหน้าร้าน (รับเข้า)');
    expect(call.metadata).toMatchObject({ kind: 'RETURN', bankAccountCode: 'S11-1201', amount: '2500.50' });
  });

  it('ปฏิเสธบัญชีที่ไม่ใช่ธนาคารหน้าร้าน (รวม S11-1106 เอง) และยอด ≤ 0 — ไม่ลงรายการ', async () => {
    const { template, journal } = setup();
    await expect(template.execute(base({ bankAccountCode: 'S11-1106' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(template.execute(base({ bankAccountCode: '11-1201' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(template.execute(base({ amount: new Decimal('0') }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(template.execute(base({ amount: new Decimal('-1') }))).rejects.toBeInstanceOf(BadRequestException);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('idempotency: รายการเดิมอยู่แล้ว → คืนรายการเดิม ไม่ลงซ้ำ', async () => {
    const { template, journal, tx } = setup();
    tx.journalEntry.findFirst.mockResolvedValue({ id: 'je-old', entryNumber: 'S-JV-2569-0001' });
    const result = await template.execute(base());
    expect(result).toEqual({ entryNo: 'S-JV-2569-0001', journalEntryId: 'je-old' });
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });
});
