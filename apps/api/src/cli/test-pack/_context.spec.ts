import {
  bkkDateStr,
  bkkMidnight,
  testName,
  testNote,
  TEST_NAME_PREFIX,
  TEST_NOTE_MARKER,
} from './_context';

describe('marker helpers', () => {
  it('testNote ขึ้นต้นด้วย marker เสมอ — cleanup ค้นด้วย startsWith', () => {
    expect(testNote('ค่าเช่าร้าน')).toBe(`${TEST_NOTE_MARKER} ค่าเช่าร้าน`);
    expect(testNote('x').startsWith(TEST_NOTE_MARKER)).toBe(true);
  });

  it('testName ขึ้นต้นด้วยคำว่าทดสอบระบบ', () => {
    expect(testName('ซัพพลายเออร์ 1')).toBe(`${TEST_NAME_PREFIX} ซัพพลายเออร์ 1`);
  });
});

describe('bkk date helpers', () => {
  // 2026-08-26T18:30:00Z = 2026-08-27 01:30 เวลาไทย → ต้องได้วันที่ 27 ไม่ใช่ 26
  const lateUtc = new Date('2026-08-26T18:30:00.000Z');

  it('bkkDateStr คืนวันที่ตามเวลาไทย ไม่ใช่ UTC', () => {
    expect(bkkDateStr(lateUtc)).toBe('20260827');
  });

  it('bkkMidnight คืนเที่ยงคืนของวันไทยวันนั้น', () => {
    const m = bkkMidnight(lateUtc);
    expect(m.getUTCFullYear()).toBe(2026);
    expect(m.getUTCMonth()).toBe(7); // สิงหาคม = 7
    expect(m.getUTCDate()).toBe(27);
    expect(m.getUTCHours()).toBe(0);
  });
});
