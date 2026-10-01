import { Decimal } from '@prisma/client/runtime/library';
import {
  CLOSE_ADVANCE_MISMATCH_MESSAGE,
  CONTRACT_ADVANCE_COLUMNS_CLEARED,
  contractCloseAdvancesFrom,
  readContractCloseAdvances,
} from './contract-close-advances';

/**
 * เงินของลูกค้าที่หักตอนยึดเครื่อง / ตัดหนี้สูญ (คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 6 — 29/09/2569 ทางเลือก (1)):
 * ยอดในสมุดบัญชี (21-1103 ทุกถัง + 21-5101) คือยอดที่หัก · คอลัมน์ของสัญญาที่ไม่ตรงบัญชี = สัญญาณเตือน
 */
describe('เงินของลูกค้าที่ต้องหักตอนปิดสัญญา (contract-close-advances)', () => {
  const dec = (v: string) => new Decimal(v);
  const contract = (cols: {
    advanceBalance?: string;
    rescheduleAdvanceBalance?: string;
    creditBalance?: string;
  }) => ({
    id: 'contract-1',
    contractNumber: 'CT-0001',
    advanceBalance: dec(cols.advanceBalance ?? '0'),
    rescheduleAdvanceBalance: dec(cols.rescheduleAdvanceBalance ?? '0'),
    creditBalance: dec(cols.creditBalance ?? '0'),
  });

  it('คอลัมน์ตรงกับบัญชี (ถังพัก 354 + ถังรวม 500 = 21-1103 854 · เครดิต 300) → หักตามบัญชี ไม่มีสัญญาณเตือน', () => {
    const r = contractCloseAdvancesFrom(
      contract({ advanceBalance: '500', rescheduleAdvanceBalance: '354', creditBalance: '300' }),
      'repossession',
      { advance: dec('854.00'), credit: dec('300.00') },
    );
    expect(r.advance.toFixed(2)).toBe('854.00');
    expect(r.credit.toFixed(2)).toBe('300.00');
    expect(r.warnings).toEqual([]);
  });

  it('ตัวอย่างฝ่ายบัญชี: เงินพักค่าปรับดิว 1,419.00 → หัก 1,419.00', () => {
    const r = contractCloseAdvancesFrom(
      contract({ rescheduleAdvanceBalance: '1419.00' }),
      'write-off',
      { advance: dec('1419.00'), credit: dec('0') },
    );
    expect(r.advance.toFixed(2)).toBe('1419.00');
    expect(r.credit.toFixed(2)).toBe('0.00');
    expect(r.warnings).toEqual([]);
  });

  it('เครดิตในคอลัมน์ 2,000 แต่บัญชี 21-5101 ไม่มียอด (เช่นเครดิตจากเปลี่ยนเครื่องเสีย) → หักตามบัญชี (0) + สัญญาณเตือนพร้อมยอดทั้งสองฝั่ง', () => {
    const r = contractCloseAdvancesFrom(contract({ creditBalance: '2000' }), 'write-off', {
      advance: dec('0'),
      credit: dec('0'),
    });
    expect(r.credit.toFixed(2)).toBe('0.00');
    expect(r.warnings).toEqual([
      {
        message: CLOSE_ADVANCE_MISMATCH_MESSAGE,
        tags: { module: 'journal', action: 'close-advance-ledger-mismatch', flow: 'write-off' },
        extra: {
          contractId: 'contract-1',
          contractNumber: 'CT-0001',
          ledger21_1103: '0.00',
          advanceBalance: '0.00',
          rescheduleAdvanceBalance: '0.00',
          ledger21_5101: '0.00',
          creditBalance: '2000.00',
        },
      },
    ]);
  });

  it('บัญชีมีเงินรับล่วงหน้าที่คอลัมน์ไม่รู้ (บัญชี 700 · คอลัมน์ 500) → หัก 700 ตามบัญชี + สัญญาณเตือน', () => {
    const r = contractCloseAdvancesFrom(contract({ advanceBalance: '500' }), 'repossession', {
      advance: dec('700.00'),
      credit: dec('0'),
    });
    expect(r.advance.toFixed(2)).toBe('700.00');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].tags).toEqual({
      module: 'journal',
      action: 'close-advance-ledger-mismatch',
      flow: 'repossession',
    });
    expect(r.warnings[0].extra).toMatchObject({
      ledger21_1103: '700.00',
      advanceBalance: '500.00',
    });
  });

  it('ยอดในบัญชีติดลบ (Dr มากกว่า Cr) → ไม่มีให้หัก (0) + สัญญาณเตือน', () => {
    const r = contractCloseAdvancesFrom(contract({}), 'write-off', {
      advance: dec('-50.00'),
      credit: dec('-10.00'),
    });
    expect(r.advance.toFixed(2)).toBe('0.00');
    expect(r.credit.toFixed(2)).toBe('0.00');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].extra).toMatchObject({ ledger21_1103: '-50.00', ledger21_5101: '-10.00' });
  });

  it('คอลัมน์ว่าง (แถวไม่มีค่า) นับเป็น 0', () => {
    const r = contractCloseAdvancesFrom({ id: 'c', contractNumber: 'CT' }, 'write-off', {
      advance: dec('0'),
      credit: dec('0'),
    });
    expect(r.warnings).toEqual([]);
  });

  it('อ่านยอด 21-1103 และ 21-5101 ของสัญญาจากสมุดบัญชี (ด้าน Cr − Dr) ด้วย client ที่ส่งมา', async () => {
    const byAccount: Record<string, { debit: Decimal; credit: Decimal }[]> = {
      '21-1103': [
        { debit: dec('0'), credit: dec('1419.00') },
        { debit: dec('0'), credit: dec('500.00') },
      ],
      '21-5101': [
        { debit: dec('0'), credit: dec('1000.00') },
        { debit: dec('700.00'), credit: dec('0') },
      ],
    };
    const findMany = jest.fn(
      async (args: { where: { accountCode: string } }) => byAccount[args.where.accountCode] ?? [],
    );
    const r = await readContractCloseAdvances(
      { journalLine: { findMany } } as never,
      contract({ advanceBalance: '500', rescheduleAdvanceBalance: '1419', creditBalance: '300' }),
      'repossession',
    );
    expect(r.advance.toFixed(2)).toBe('1919.00');
    expect(r.credit.toFixed(2)).toBe('300.00');
    expect(r.warnings).toEqual([]);
    expect(findMany.mock.calls.map((c) => c[0].where.accountCode)).toEqual(['21-1103', '21-5101']);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        journalEntry: {
          metadata: { path: ['contractId'], equals: 'contract-1' },
          status: 'POSTED',
          deletedAt: null,
        },
      },
    });
  });

  it('ค่าที่ผู้เรียกเขียนลงสัญญา = ศูนย์ทั้งสามคอลัมน์', () => {
    expect(CONTRACT_ADVANCE_COLUMNS_CLEARED).toEqual({
      advanceBalance: 0,
      rescheduleAdvanceBalance: 0,
      creditBalance: 0,
    });
  });
});
