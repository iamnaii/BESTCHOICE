import { BadRequestException } from '@nestjs/common';
import {
  ADVANCE_EXCESS_INCOME_FLOW,
  ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE,
  assertNoAdvanceExcessIncome,
  findActiveAdvanceExcessIncome,
  listAdvanceExcessIncomeEntries,
} from './advance-excess-income.util';

/**
 * ด่าน ต6ข (PR4): สัญญาที่ลงรายได้เงินพักส่วนเกิน (42-1106) แล้ว ห้ามยกเลิกใบเสร็จจนกว่าฝ่ายบัญชีจะกลับรายการ —
 * ตัวช่วยอ่านรายการ `flow = 'advance-excess-income'` ของสัญญาแล้วกรอง `reversed` ใน JS (แบบเดียวกับตัวจับคู่
 * ของการยกเลิกใบเสร็จ: JSON-path equality บนคีย์ที่ไม่มีเป็น NULL ใน SQL).
 */
describe('advance-excess-income.util — ด่าน ต6ข', () => {
  const client = (rows: Array<Record<string, unknown>>) => ({
    journalEntry: { findMany: jest.fn().mockResolvedValue(rows) },
  });

  it('listAdvanceExcessIncomeEntries ค้นด้วย flow + contractId + POSTED + ไม่ถูกลบ และคืนทุกแถว (รวมที่ถูกกลับแล้ว)', async () => {
    const c = client([
      {
        id: 'je-1',
        entryNumber: 'JE-1',
        metadata: { flow: ADVANCE_EXCESS_INCOME_FLOW, reversed: true },
      },
      { id: 'je-2', entryNumber: 'JE-2', metadata: { flow: ADVANCE_EXCESS_INCOME_FLOW } },
    ]);
    const all = await listAdvanceExcessIncomeEntries(c as never, 'contract-1');
    expect(all.map((e) => e.id)).toEqual(['je-1', 'je-2']);
    const where = c.journalEntry.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      { metadata: { path: ['flow'], equals: ADVANCE_EXCESS_INCOME_FLOW } },
      { metadata: { path: ['contractId'], equals: 'contract-1' } },
    ]);
    expect(where.status).toBe('POSTED');
    expect(where.deletedAt).toBeNull();
  });

  it('findActiveAdvanceExcessIncome ข้ามรายการที่ `reversed === true` (ฝ่ายบัญชีกลับรายการแล้ว = ยกเลิกใบเสร็จได้อีกครั้ง) และแถวที่ไม่ใช่ flow นี้', async () => {
    const c = client([
      {
        id: 'je-1',
        entryNumber: 'JE-1',
        metadata: { flow: ADVANCE_EXCESS_INCOME_FLOW, reversed: true },
      },
      { id: 'je-2', entryNumber: 'JE-2', metadata: { flow: ADVANCE_EXCESS_INCOME_FLOW } },
      // แถวที่หลุดมาจากคำค้นที่กว้างกว่า (เช่น mock ที่ไม่สนใจ where) — ไม่ใช่รายการของ flow นี้ ⇒ ไม่นับ
      { id: 'je-3', entryNumber: 'JE-3', metadata: null },
      { id: 'je-4', entryNumber: 'JE-4', metadata: { tag: 'receipt' } },
    ]);
    const active = await findActiveAdvanceExcessIncome(c as never, 'contract-1');
    expect(active.map((e) => e.entryNumber)).toEqual(['JE-2']);
  });

  it('assertNoAdvanceExcessIncome โยน BadRequestException ข้อความ ต6ข เมื่อมีรายการที่มีผล', async () => {
    const c = client([
      { id: 'je-2', entryNumber: 'JE-2', metadata: { flow: ADVANCE_EXCESS_INCOME_FLOW } },
    ]);
    await expect(assertNoAdvanceExcessIncome(c as never, 'contract-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(assertNoAdvanceExcessIncome(c as never, 'contract-1')).rejects.toThrow(
      ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE,
    );
    expect(ADVANCE_EXCESS_VOID_BLOCKED_MESSAGE).toBe(
      'สัญญานี้ลงรายได้เงินพักส่วนเกิน (42-1106) แล้ว — ต้องให้ผู้ดูแลระบบกลับรายการกวาดก่อน (คำสั่ง advance-excess:reverse)',
    );
  });

  it('assertNoAdvanceExcessIncome ผ่านเมื่อไม่มีรายการ หรือทุกรายการถูกกลับแล้ว', async () => {
    await expect(
      assertNoAdvanceExcessIncome(client([]) as never, 'contract-1'),
    ).resolves.toBeUndefined();
    await expect(
      assertNoAdvanceExcessIncome(
        client([{ id: 'je-1', entryNumber: 'JE-1', metadata: { reversed: true } }]) as never,
        'contract-1',
      ),
    ).resolves.toBeUndefined();
  });
});
