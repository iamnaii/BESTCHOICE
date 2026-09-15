import { describe, expect, it } from 'vitest';
import { formatThaiDateShort, formatThaiTime } from '@/lib/date';
import { groupEventsByDate, relativeTimeLabel } from '../eventTimelineUtils';

// ค่าทดสอบสร้างจากปฏิทินท้องถิ่น (new Date(y, m, d, ...)) ไม่ใช่ UTC instant ('...Z') —
// groupEventsByDate ตัดวันด้วย setHours(0,0,0,0) ของเครื่องผู้ใช้ (เจตนา — ดู eventTimelineUtils.ts)
// ค่า 'Z' ใกล้เที่ยงคืนจะข้ามวันไม่เหมือนกันในแต่ละ timezone ที่รันเทส (พังที่ Asia/Bangkok มาก่อน)
const NOW = new Date(2026, 8, 15, 12, 0, 0); // 15 ก.ย. 2569 เที่ยง (เวลาท้องถิ่น)
const OLDER = new Date(2026, 8, 12, 9, 15, 0).toISOString();

describe('groupEventsByDate', () => {
  it('วันนี้ / เมื่อวาน / วันที่ — คงลำดับที่ส่งมา ไม่เรียงใหม่', () => {
    const groups = groupEventsByDate(
      [
        { id: 'a', timestamp: new Date(2026, 8, 15, 11, 30, 0).toISOString() }, // วันนี้ เช้ากว่า NOW
        { id: 'b', timestamp: new Date(2026, 8, 15, 8, 0, 0).toISOString() }, // วันนี้ เช้ากว่านั้นอีก
        { id: 'c', timestamp: new Date(2026, 8, 14, 23, 59, 0).toISOString() }, // เมื่อวาน ดึกๆ
        { id: 'd', timestamp: OLDER },
        { id: 'e', timestamp: new Date(2026, 8, 12, 8, 0, 0).toISOString() },
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['วันนี้', 'เมื่อวาน', formatThaiDateShort(OLDER)]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
  });

  it('ไม่มีรายการ → ไม่มีกลุ่ม', () => {
    expect(groupEventsByDate([], NOW)).toEqual([]);
  });
});

describe('relativeTimeLabel', () => {
  const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

  it('ไม่ถึงนาที → ตอนนี้ · ไม่ถึงชั่วโมง → นาที · ไม่ถึงวัน → ชม. · เกินวัน → เวลา', () => {
    expect(relativeTimeLabel(at(30_000), NOW.getTime())).toBe('ตอนนี้');
    expect(relativeTimeLabel(at(5 * 60_000), NOW.getTime())).toBe('5 นาทีที่แล้ว');
    expect(relativeTimeLabel(at(3 * 3_600_000), NOW.getTime())).toBe('3 ชม.ที่แล้ว');
    expect(relativeTimeLabel(at(30 * 3_600_000), NOW.getTime())).toBe(formatThaiTime(at(30 * 3_600_000)));
  });
});
