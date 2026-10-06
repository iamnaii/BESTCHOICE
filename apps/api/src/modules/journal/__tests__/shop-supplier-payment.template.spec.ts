/**
 * ShopSupplierPaymentTemplate — รายการบัญชีสมุดหน้าร้านของเมนูจ่ายเงินผู้จัดจำหน่าย (ก้อน 2 · 2026-10-05)
 * อยู่ใน journal/__tests__ เพราะ jest ของ api ข้าม spec ใต้ cpa-templates/ (ดู package.json testPathIgnorePatterns)
 */
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  ShopSupplierPaymentTemplate,
  ShopSupplierPaymentInput,
} from '../cpa-templates/shop-supplier-payment.template';

type Line = { accountCode: string; dr: Decimal; cr: Decimal };

function setup() {
  const journal = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-new', entryNumber: 'S-JV-2569-0001' }) };
  const tx = {
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const companyResolver = { getShopCompanyId: jest.fn().mockResolvedValue('shop-co') };
  const template = new ShopSupplierPaymentTemplate(journal as never, prisma as never, companyResolver as never);
  const lastCall = () => journal.createAndPost.mock.calls[0][0] as {
    lines: Line[]; metadata: Record<string, unknown>; companyId: string; postedAt: Date; reference: string; description: string;
  };
  const asPairs = (lines: Line[]) => lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)]);
  return { journal, tx, template, lastCall, asPairs };
}

const base = (over: Partial<ShopSupplierPaymentInput>): ShopSupplierPaymentInput => ({
  idempotencyKey: 'po-payment:p1',
  kind: 'DEPOSIT',
  poId: 'po-1',
  poNumber: 'PO-2569-0042',
  supplierId: 'sup-1',
  supplierName: 'บจก. โมบายล์',
  paymentId: 'p1',
  amount: new Decimal('5000'),
  bankAccountCode: 'S11-1202',
  postedAt: new Date('2026-09-27T17:00:00.000Z'),
  ...over,
});

describe('ShopSupplierPaymentTemplate.execute', () => {
  it('DEPOSIT: Dr S11-4201 / Cr ธนาคารจ่ายออก S11-1202 พร้อม metadata ที่ ledger ใช้', async () => {
    const { template, tx, lastCall, asPairs } = setup();
    const out = await template.execute(base({}), tx as never);
    expect(out).toEqual({ entryNo: 'S-JV-2569-0001', journalEntryId: 'je-new' });
    const call = lastCall();
    expect(asPairs(call.lines)).toEqual([
      ['S11-4201', '5000.00', '0.00'],
      ['S11-1202', '0.00', '5000.00'],
    ]);
    expect(call.companyId).toBe('shop-co');
    expect(call.postedAt).toEqual(new Date('2026-09-27T17:00:00.000Z'));
    expect(call.reference).toBe('po:po-1:payment:p1');
    expect(call.metadata).toMatchObject({
      tag: 'SHOP_SUPPLIER_PAYMENT',
      flow: 'shop-supplier-payment',
      idempotencyKey: 'po-payment:p1',
      kind: 'DEPOSIT',
      poId: 'po-1',
      poNumber: 'PO-2569-0042',
      supplierId: 'sup-1',
      supplierName: 'บจก. โมบายล์',
      paymentId: 'p1',
      bankAccountCode: 'S11-1202',
      companyCode: 'SHOP',
      amount: '5000.00',
    });
  });

  it('SETTLEMENT: Dr เจ้าหนี้ตามบรรทัดที่ปันมา / Cr ธนาคาร รวมเท่ายอด', async () => {
    const { template, tx, lastCall, asPairs } = setup();
    await template.execute(
      base({
        kind: 'SETTLEMENT',
        amount: new Decimal('10729'),
        payableLines: [
          { accountCode: 'S21-1101', amount: new Decimal('8000') },
          { accountCode: 'S21-1102', amount: new Decimal('2729') },
        ],
      }),
      tx as never,
    );
    expect(asPairs(lastCall().lines)).toEqual([
      ['S21-1101', '8000.00', '0.00'],
      ['S21-1102', '2729.00', '0.00'],
      ['S11-1202', '0.00', '10729.00'],
    ]);
  });

  it('DEPOSIT_APPLIED: Dr เจ้าหนี้ / Cr มัดจำ S11-4201 ไม่แตะธนาคาร', async () => {
    const { template, tx, lastCall, asPairs } = setup();
    await template.execute(
      base({
        kind: 'DEPOSIT_APPLIED',
        bankAccountCode: undefined,
        receivingId: 'gr-1',
        grNumber: 'GR-000012',
        payableLines: [{ accountCode: 'S21-1101', amount: new Decimal('5000') }],
      }),
      tx as never,
    );
    expect(asPairs(lastCall().lines)).toEqual([
      ['S21-1101', '5000.00', '0.00'],
      ['S11-4201', '0.00', '5000.00'],
    ]);
    expect(lastCall().metadata).toMatchObject({ kind: 'DEPOSIT_APPLIED', receivingId: 'gr-1', grNumber: 'GR-000012' });
  });

  it('DEPOSIT_REFUND ได้คืนไม่ครบ: Dr ธนาคารรับเข้า S11-1201 ส่วนที่ได้คืน + Dr S53-1105 ส่วนขาด / Cr S11-4201 ทั้งก้อน', async () => {
    const { template, tx, lastCall, asPairs } = setup();
    await template.execute(
      base({ kind: 'DEPOSIT_REFUND', amount: new Decimal('3000'), shortfall: new Decimal('500'), bankAccountCode: 'S11-1201' }),
      tx as never,
    );
    expect(asPairs(lastCall().lines)).toEqual([
      ['S11-1201', '2500.00', '0.00'],
      ['S53-1105', '500.00', '0.00'],
      ['S11-4201', '0.00', '3000.00'],
    ]);
  });

  it('DEPOSIT_REFUND ได้คืนครบ: ไม่มีบรรทัด S53-1105', async () => {
    const { template, tx, lastCall, asPairs } = setup();
    await template.execute(base({ kind: 'DEPOSIT_REFUND', amount: new Decimal('3000'), bankAccountCode: 'S11-1201' }), tx as never);
    expect(asPairs(lastCall().lines)).toEqual([
      ['S11-1201', '3000.00', '0.00'],
      ['S11-4201', '0.00', '3000.00'],
    ]);
  });

  it('DEPOSIT_FORFEIT: Dr S53-1105 / Cr S11-4201', async () => {
    const { template, tx, lastCall, asPairs } = setup();
    await template.execute(base({ kind: 'DEPOSIT_FORFEIT', amount: new Decimal('3000'), bankAccountCode: undefined }), tx as never);
    expect(asPairs(lastCall().lines)).toEqual([
      ['S53-1105', '3000.00', '0.00'],
      ['S11-4201', '0.00', '3000.00'],
    ]);
  });

  it('ปฏิเสธยอดศูนย์/ติดลบ · บรรทัดเจ้าหนี้รวมไม่เท่ายอด · รหัสบัญชีนอกกติกา', async () => {
    const { template, tx, journal } = setup();
    await expect(template.execute(base({ amount: new Decimal('0') }), tx as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      template.execute(
        base({ kind: 'SETTLEMENT', amount: new Decimal('100'), payableLines: [{ accountCode: 'S21-1101', amount: new Decimal('90') }] }),
        tx as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      template.execute(
        base({ kind: 'SETTLEMENT', amount: new Decimal('100'), payableLines: [{ accountCode: 'S21-1103', amount: new Decimal('100') }] }),
        tx as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(template.execute(base({ bankAccountCode: 'S11-1101' }), tx as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      template.execute(base({ kind: 'DEPOSIT_REFUND', amount: new Decimal('3000'), shortfall: new Decimal('3001'), bankAccountCode: 'S11-1201' }), tx as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('idempotent: มี JE ของ idempotencyKey เดิมแล้ว → คืนใบเดิม ไม่โพสต์ซ้ำ', async () => {
    const { template, tx, journal } = setup();
    tx.journalEntry.findFirst.mockResolvedValueOnce({ id: 'je-old', entryNumber: 'S-JV-OLD' });
    const out = await template.execute(base({}), tx as never);
    expect(out).toEqual({ entryNo: 'S-JV-OLD', journalEntryId: 'je-old' });
    expect(journal.createAndPost).not.toHaveBeenCalled();
    expect(tx.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-supplier-payment' } },
            { metadata: { path: ['idempotencyKey'], equals: 'po-payment:p1' } },
          ],
        }),
      }),
    );
  });
});

describe('ShopSupplierPaymentTemplate.reverse', () => {
  it('กลับรายการ JE เดิมทุกบรรทัด (สลับ Dr/Cr) + metadata ชี้ใบเดิมและเหตุผล', async () => {
    const { template, tx, lastCall, asPairs } = setup();
    tx.journalEntry.findUnique.mockResolvedValue({
      id: 'je-orig',
      entryNumber: 'S-JV-2569-0101',
      metadata: { tag: 'SHOP_SUPPLIER_PAYMENT', kind: 'SETTLEMENT', poId: 'po-1', poNumber: 'PO-2569-0042', supplierId: 'sup-1', supplierName: 'บจก. โมบายล์', paymentId: 'p1' },
      lines: [
        { accountCode: 'S21-1101', debit: new Decimal('8000'), credit: new Decimal('0'), description: 'x' },
        { accountCode: 'S11-1202', debit: new Decimal('0'), credit: new Decimal('8000'), description: 'y' },
      ],
    });
    const out = await template.reverse(
      { journalEntryId: 'je-orig', idempotencyKey: 'po-payment-void:p1', reason: 'กรอกยอดผิด', postedAt: new Date('2026-10-04T17:00:00.000Z') },
      tx as never,
    );
    expect(out).toEqual({ entryNo: 'S-JV-2569-0001', journalEntryId: 'je-new' });
    const call = lastCall();
    expect(asPairs(call.lines)).toEqual([
      ['S21-1101', '0.00', '8000.00'],
      ['S11-1202', '8000.00', '0.00'],
    ]);
    expect(call.metadata).toMatchObject({
      tag: 'SHOP_SUPPLIER_PAYMENT_REVERSAL',
      flow: 'shop-supplier-payment',
      idempotencyKey: 'po-payment-void:p1',
      reversesEntryId: 'je-orig',
      reversesEntryNo: 'S-JV-2569-0101',
      reason: 'กรอกยอดผิด',
      kind: 'SETTLEMENT',
      poId: 'po-1',
      supplierId: 'sup-1',
      paymentId: 'p1',
      companyCode: 'SHOP',
    });
    expect(call.companyId).toBe('shop-co');
  });

  it('ไม่พบ JE เดิม หรือใบเดิมไม่ใช่ของเมนูนี้ → BadRequest', async () => {
    const { template, tx } = setup();
    tx.journalEntry.findUnique.mockResolvedValueOnce(null);
    await expect(
      template.reverse({ journalEntryId: 'nope', idempotencyKey: 'k', reason: 'r' }, tx as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    tx.journalEntry.findUnique.mockResolvedValueOnce({ id: 'je-x', entryNumber: 'X', metadata: { tag: 'SHOP_GOODS_RECEIVING' }, lines: [] });
    await expect(
      template.reverse({ journalEntryId: 'je-x', idempotencyKey: 'k', reason: 'r' }, tx as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
