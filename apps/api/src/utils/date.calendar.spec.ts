import { addBkkDays, addBkkMonths, bangkokDayDiff } from './date.util';

describe('Bangkok calendar arithmetic', () => {
  it('adds business days independently of server timezone', () => {
    // March 1, 00:30 BKK lies on February 28 UTC.
    const anchor = new Date('2026-02-28T17:30:00.123Z');
    expect(addBkkDays(anchor, 14).toISOString()).toBe('2026-03-14T17:30:00.123Z');
    expect(anchor.toISOString()).toBe('2026-02-28T17:30:00.123Z');
  });

  it('uses the Bangkok day and preserves time when crossing the UTC month boundary', () => {
    const anchor = new Date('2026-01-30T17:00:00.000Z'); // January 31 BKK
    expect(addBkkMonths(anchor, 1).toISOString()).toBe('2026-02-27T17:00:00.000Z');
    expect(addBkkMonths(anchor, 2).toISOString()).toBe('2026-03-30T17:00:00.000Z');
    expect(addBkkMonths(anchor, 3).toISOString()).toBe('2026-04-29T17:00:00.000Z');
    expect(anchor.toISOString()).toBe('2026-01-30T17:00:00.000Z');
  });

  it('keeps the calendar day across a year boundary', () => {
    const anchor = new Date('2026-12-10T17:00:00.000Z'); // December 11 BKK
    expect(addBkkMonths(anchor, 2).toISOString()).toBe('2027-02-10T17:00:00.000Z');
  });
});

describe('bangkokDayDiff', () => {
  const DUE_27_AUG = new Date('2026-08-26T17:00:00.000Z'); // 27 ส.ค. 2569 00:00 เวลาไทย

  it('นับเป็นวันปฏิทินไทย ไม่ขึ้นกับเวลาในวัน', () => {
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-26T17:30:00.000Z'))).toBe(0); // 27 ส.ค. 00:30
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-27T16:59:59.999Z'))).toBe(0); // 27 ส.ค. 23:59
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-27T17:00:00.000Z'))).toBe(1); // 28 ส.ค. 00:00
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-27T17:30:00.000Z'))).toBe(1); // 28 ส.ค. 00:30
  });

  it('วันที่ต้นทางที่ไม่ได้อยู่ที่เที่ยงคืนไทย (ข้อมูลเก่าเก็บ 07:00) ได้ผลเท่ากัน', () => {
    const legacyDue = new Date('2026-08-27T00:00:00.000Z'); // 27 ส.ค. 07:00 เวลาไทย
    expect(bangkokDayDiff(legacyDue, new Date('2026-08-27T17:30:00.000Z'))).toBe(1);
    expect(bangkokDayDiff(legacyDue, new Date('2026-09-26T17:30:00.000Z'))).toBe(31);
  });

  it('คืนค่าติดลบเมื่อปลายทางอยู่ก่อนต้นทาง', () => {
    expect(bangkokDayDiff(DUE_27_AUG, new Date('2026-08-25T17:00:00.000Z'))).toBe(-1);
  });
});
