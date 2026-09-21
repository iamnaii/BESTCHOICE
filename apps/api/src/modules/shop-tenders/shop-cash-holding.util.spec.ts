import { Prisma } from '@prisma/client';
import { allocateDeposits, postedPortion, type HoldingClose } from './shop-cash-holding.util';
import { dayStates } from './shop-cash-overview.service';

const d = (value: number) => new Prisma.Decimal(value);
const close = (id: string, amount: number, posted = true, day = 1): HoldingClose =>
  ({ id, amount: d(amount), posted, confirmedAt: new Date(Date.UTC(2026, 8, day)) });

describe('allocateDeposits — เงินนำฝากตัดการปิดยอดที่เก่าที่สุดก่อน', () => {
  const closes = [close('a', 7100, true, 17), close('b', 5600, true, 18), close('c', 5500, true, 19)];

  it('ยังไม่ฝากเลย = ค้างครบทุกครั้ง', () => {
    const result = allocateDeposits(closes, d(0));
    expect(result.outstanding.toFixed(2)).toBe('18200.00');
    expect(result.openCloses.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(result.settledCloseIds).toEqual([]);
  });

  it('ฝากบางส่วน: ครั้งเก่าสุดถูกปิดก่อน ที่เหลือค้างต่อ', () => {
    const result = allocateDeposits(closes, d(10000));
    expect(result.settledCloseIds).toEqual(['a']);
    expect(result.openCloses.map((row) => [row.id, row.outstanding.toFixed(2)])).toEqual([['b', '2700.00'], ['c', '5500.00']]);
    expect(result.outstanding.toFixed(2)).toBe('8200.00');
  });

  it('ฝากครบ = ไม่เหลือยอดค้าง · การปิดยอดที่ไม่มีเงินส่ง (0 บาท) ถือว่าจบในตัว', () => {
    expect(allocateDeposits(closes, d(18200))).toMatchObject({ openCloses: [], settledCloseIds: ['a', 'b', 'c'] });
    expect(allocateDeposits([close('z', 0)], d(0))).toMatchObject({ openCloses: [], settledCloseIds: ['z'] });
  });
});

describe('postedPortion — JE นำฝากล้างบัญชีแหล่งเก็บได้เฉพาะส่วนที่ต้นทางเคยลงบัญชี', () => {
  it('ต้นทางลงบัญชีครบ = ลงเต็มยอดฝาก', () => {
    expect(postedPortion([close('a', 1000), close('b', 500)], d(0), d(1200)).toFixed(2)).toBe('1200.00');
  });

  it('ครั้งกลางข้ามการลงบัญชี (สาขายังไม่ตั้งลิ้นชัก) = ตัดส่วนนั้นออก ตามช่วงสะสมที่ยอดฝากครั้งนี้ครอบ', () => {
    const closes = [close('a', 1000, true), close('b', 500, false), close('c', 800, true)];
    expect(postedPortion(closes, d(0), d(2300)).toFixed(2)).toBe('1800.00');
    // ฝากไปแล้ว 900 → ครั้งนี้ 700 ครอบช่วง [900, 1600): a เหลือ 100 (ลงบัญชี) + b 500 (ไม่ลง) + c 100 (ลงบัญชี)
    expect(postedPortion(closes, d(900), d(700)).toFixed(2)).toBe('200.00');
    expect(postedPortion([close('x', 8400, false)], d(0), d(8400)).toFixed(2)).toBe('0.00');
  });
});

describe('dayStates — สถานะของหนึ่งวัน ณ สิ้นวันนั้น', () => {
  // เวลาไทย = UTC+7 ⇒ 2026-09-19T05:00Z = 19 ก.ย. 12:00
  const at = (day: number, hourBkk: number) => new Date(Date.UTC(2026, 8, day, hourBkk - 7));
  const dates = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'];
  const now = at(21, 11);
  const run = (closes: { countedAt: Date; state: 'AWAITING_CONFIRM' | 'AT_BRANCH' | 'REACHED' }[], cashInTimes: Date[]) =>
    dayStates({ dates, today: '2026-09-21', now, closes, cashInTimes });

  it('ไม่มีเงินสด ไม่มีการปิดยอด = NO_CASH ทุกวัน', () => {
    expect(run([], [])).toEqual(['NO_CASH', 'NO_CASH', 'NO_CASH', 'NO_CASH']);
  });

  it('มีเงินสดแต่ไม่มีใครนับ: วันที่ผ่านไปแล้ว = MISSED และแดงต่อเนื่องจนกว่าจะมีการนับ · วันนี้ = NOT_COUNTED', () => {
    expect(run([], [at(19, 14)])).toEqual(['NO_CASH', 'MISSED', 'MISSED', 'NOT_COUNTED']);
  });

  it('นับวันถัดไป: วันที่ไม่ได้นับยังแดงเป็นประวัติ วันที่นับใช้สถานะของการปิดยอด', () => {
    expect(run([{ countedAt: at(20, 9), state: 'REACHED' }], [at(19, 14)])).toEqual(['NO_CASH', 'MISSED', 'REACHED', 'NO_CASH']);
  });

  it('เงินสดที่รับหลังปิดยอดของวันนั้น ไม่ทำให้วันนั้นแดง แต่ถ้าวันถัดไปไม่มีใครนับ วันถัดไปแดง', () => {
    expect(run([{ countedAt: at(19, 20), state: 'REACHED' }], [at(19, 14), at(19, 21)])).toEqual(['NO_CASH', 'REACHED', 'MISSED', 'NOT_COUNTED']);
  });

  it('หลายครั้งในวันเดียว = ครั้งที่แย่ที่สุดเป็นตัวแทน (รอยืนยัน > ยังอยู่ที่สาขา > ถึงบริษัทแล้ว)', () => {
    expect(run([{ countedAt: at(19, 12), state: 'REACHED' }, { countedAt: at(19, 20), state: 'AT_BRANCH' }], [at(19, 10)])[1]).toBe('AT_BRANCH');
    expect(run([{ countedAt: at(19, 12), state: 'AWAITING_CONFIRM' }, { countedAt: at(19, 20), state: 'REACHED' }], [at(19, 10)])[1]).toBe('AWAITING_CONFIRM');
  });

  it('การปิดยอดที่เกิดหลัง "ตอนนี้" ของวันนี้ไม่ถูกนับ (กันนาฬิกาเพี้ยน)', () => {
    expect(run([{ countedAt: at(21, 15), state: 'REACHED' }], [at(21, 9)])[3]).toBe('NOT_COUNTED');
  });
});
