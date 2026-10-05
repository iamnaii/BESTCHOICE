import { Decimal } from '@prisma/client/runtime/library';
import { resolveBookedInventory } from './booked-inventory.util';

/**
 * ก้อน 3 — ก่อนเครดิตสินค้าคงคลังตอนตัดจำหน่าย ต้องมีหลักฐานว่าเครื่องลงบัญชีรับเข้าแล้ว
 * (ใบรับของที่มีเลขรายการ / รับซื้อมือสอง / รับคืนเครื่อง / เปลี่ยนเครื่อง A.4) — ไม่มี = ไม่ลง JE
 */
type Je = { id: string; entryNumber: string; metadata: Record<string, unknown>; lines: { accountCode: string; debit: Decimal; credit: Decimal }[] };

function buildTx(opts: {
  grItem?: { receivedCost: Decimal | null; journalEntryId: string | null; receiving: { grNumber: string } } | null;
  product?: { checklistResults: unknown } | null;
  jeByFlow?: Record<string, Je | null>;
}) {
  const jeByFlow = opts.jeByFlow ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    goodsReceivingItem: { findFirst: jest.fn().mockResolvedValue(opts.grItem ?? null) },
    product: { findUnique: jest.fn().mockResolvedValue(opts.product ?? { checklistResults: null }) },
    journalEntry: {
      findUnique: jest.fn().mockResolvedValue({ entryNumber: 'JE-GR-001' }),
      findFirst: jest.fn().mockImplementation(async ({ where }: { where: unknown }) => {
        const text = JSON.stringify(where);
        for (const [flow, je] of Object.entries(jeByFlow)) if (text.includes(`"${flow}"`)) return je;
        return null;
      }),
    },
  };
  return tx;
}
const line = (code: string, dr: string) => ({ accountCode: code, debit: new Decimal(dr), credit: new Decimal(0) });

describe('resolveBookedInventory', () => {
  it('ใบรับของที่มีเลขรายการ → booked GOODS_RECEIVING ด้วย receivedCost + เลขใบรับของ', async () => {
    const tx = buildTx({ grItem: { receivedCost: new Decimal('10486'), journalEntryId: 'je-gr', receiving: { grNumber: 'GR-20261005-001' } } });
    const out = await resolveBookedInventory(tx, 'p1');
    expect(out).toEqual({ booked: true, source: 'GOODS_RECEIVING', bookedAmount: new Decimal('10486'), journalEntryNo: 'JE-GR-001', grNumber: 'GR-20261005-001' });
    expect(tx.journalEntry.findFirst).not.toHaveBeenCalled();
  });

  it('ใบรับของที่ยังไม่มีเลขรายการ (เครื่องรอถ่ายรูป) → ไม่ booked และหยุด ไม่ค้นสายอื่น', async () => {
    const tx = buildTx({
      grItem: { receivedCost: new Decimal('7000'), journalEntryId: null, receiving: { grNumber: 'GR-20261005-002' } },
      jeByFlow: { 'shop-trade-in': { id: 'x', entryNumber: 'JE-X', metadata: {}, lines: [line('S11-2002', '7000')] } },
    });
    const out = await resolveBookedInventory(tx, 'p1');
    expect(out).toEqual({ booked: false, source: null, bookedAmount: null, journalEntryNo: null, grNumber: 'GR-20261005-002' });
    expect(tx.journalEntry.findFirst).not.toHaveBeenCalled();
    expect(tx.product.findUnique).not.toHaveBeenCalled();
  });

  it('รับซื้อมือสอง (checklistResults.source trade-in) → booked TRADE_IN ด้วยยอด Dr S11-2002 ของรายการ', async () => {
    const tx = buildTx({
      product: { checklistResults: { source: 'trade-in', tradeInId: 't1' } },
      jeByFlow: { 'shop-trade-in': { id: 'je-t', entryNumber: 'JE-T', metadata: { tradeInId: 't1' }, lines: [line('S11-2002', '7000'), { accountCode: 'S11-1101', debit: new Decimal(0), credit: new Decimal('7000') }] } },
    });
    const out = await resolveBookedInventory(tx, 'p1');
    expect(out).toMatchObject({ booked: true, source: 'TRADE_IN', journalEntryNo: 'JE-T', grNumber: null });
    expect(out.bookedAmount?.toFixed(2)).toBe('7000.00');
    const where = JSON.stringify(tx.journalEntry.findFirst.mock.calls[0][0].where);
    expect(where).toContain('"tradeInId"');
    expect(where).toContain('"t1"');
  });

  it('รับเทิร์น (shop-trade-in-credit-issued metadata.tradeInId) → booked TRADE_IN ด้วยยอด Dr S11-2002 (final review C1)', async () => {
    const tx = buildTx({
      product: { checklistResults: { source: 'trade-in', tradeInId: 't2' } },
      jeByFlow: {
        'shop-trade-in-credit-issued': {
          id: 'je-c', entryNumber: 'JE-202610-00031', metadata: { flow: 'shop-trade-in-credit-issued', tradeInId: 't2' },
          lines: [
            { accountCode: 'S11-2002', debit: new Decimal('8000.00'), credit: new Decimal(0) },
            { accountCode: 'S21-2003', debit: new Decimal(0), credit: new Decimal('8000.00') },
          ],
        },
      },
    });
    const r = await resolveBookedInventory(tx, 'p1');
    expect(r).toEqual({ booked: true, source: 'TRADE_IN', bookedAmount: new Decimal('8000.00'), journalEntryNo: 'JE-202610-00031', grNumber: null });
    const where = JSON.stringify(tx.journalEntry.findFirst.mock.calls[0][0].where);
    expect(where).toContain('"t2"');
  });

  it('รับคืนเครื่อง (shop-repossession-intake metadata.productId) → REPOSSESSION', async () => {
    const tx = buildTx({ jeByFlow: { 'shop-repossession-intake': { id: 'je-r', entryNumber: 'JE-R', metadata: { productId: 'p1' }, lines: [line('S11-2002', '5000')] } } });
    const out = await resolveBookedInventory(tx, 'p1');
    expect(out).toMatchObject({ booked: true, source: 'REPOSSESSION', journalEntryNo: 'JE-R' });
    expect(out.bookedAmount?.toFixed(2)).toBe('5000.00');
  });

  it('เปลี่ยนเครื่อง A.4 (shop-exchange-return metadata.oldProductId) → EXCHANGE_RETURN · ถ้าใบถูกกลับรายการแล้วไม่นับ', async () => {
    const je: Je = { id: 'je-e', entryNumber: 'JE-E', metadata: { oldProductId: 'p1' }, lines: [line('S11-2002', '8000')] };
    expect(await resolveBookedInventory(buildTx({ jeByFlow: { 'shop-exchange-return': je } }), 'p1')).toMatchObject({ booked: true, source: 'EXCHANGE_RETURN' });
    const reversed = { ...je, metadata: { ...je.metadata, reversed: true } };
    expect(await resolveBookedInventory(buildTx({ jeByFlow: { 'shop-exchange-return': reversed } }), 'p1')).toMatchObject({ booked: false, source: null });
  });

  it('รายการที่เจอไม่มีบรรทัด Dr S11-200x → ไม่นับว่า booked', async () => {
    const tx = buildTx({ jeByFlow: { 'shop-repossession-intake': { id: 'je-r', entryNumber: 'JE-R', metadata: { productId: 'p1' }, lines: [line('S21-1104', '5000')] } } });
    expect(await resolveBookedInventory(tx, 'p1')).toMatchObject({ booked: false, source: null, bookedAmount: null });
  });

  it('ไม่มีหลักฐานเลย (ของยกมา / เพิ่มด้วยมือ) → booked false ทุกช่อง null', async () => {
    expect(await resolveBookedInventory(buildTx({}), 'p1')).toEqual({ booked: false, source: null, bookedAmount: null, journalEntryNo: null, grNumber: null });
  });
});
