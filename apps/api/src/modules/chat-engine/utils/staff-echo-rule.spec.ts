import { isHumanStaffEchoTiming, PAGE_AUTOREPLY_MAX_DELAY_MS } from './staff-echo-rule';

const echoAt = new Date('2026-11-27T03:00:10.000Z');
const before = (ms: number) => new Date(echoAt.getTime() - ms);

describe('isHumanStaffEchoTiming — echo ช้ากว่าข้อความลูกค้าเกิน 5 วินาที = คนตอบ', () => {
  const cases: Array<[string, Date | null, boolean]> = [
    ['ไม่มีข้อความลูกค้าก่อนหน้า = คนตอบ', null, true],
    ['ลูกค้าทักเวลาเดียวกันพอดี = เพจตอบเอง', before(0), false],
    ['4.999 วิ = เพจตอบเอง', before(4_999), false],
    ['5 วิพอดี (ขอบ) = เพจตอบเอง', before(5_000), false],
    ['5.001 วิ = คนตอบ', before(5_001), true],
    ['3 นาที = คนตอบ', before(180_000), true],
  ];
  it.each(cases)('%s', (_label, customerAtBefore, expected) => {
    expect(isHumanStaffEchoTiming({ echoAt, customerAtBefore })).toBe(expected);
  });

  it('เกณฑ์ = 5 วินาที (คำตัดสินเจ้าของ D1 2026-11-26)', () => {
    expect(PAGE_AUTOREPLY_MAX_DELAY_MS).toBe(5_000);
  });
});
