import { describe, expect, it } from 'vitest';
import { formatThaiDateShort, formatThaiTime } from '@/lib/date';
import { groupEventsByDate, relativeTimeLabel } from '../eventTimelineUtils';

const NOW = new Date('2026-09-15T05:00:00.000Z');
const OLDER = '2026-09-12T09:15:00.000Z';

describe('groupEventsByDate', () => {
  it('วันนี้ / เมื่อวาน / วันที่ — คงลำดับที่ส่งมา ไม่เรียงใหม่', () => {
    const groups = groupEventsByDate(
      [
        { id: 'a', timestamp: '2026-09-15T04:30:00.000Z' },
        { id: 'b', timestamp: '2026-09-15T01:00:00.000Z' },
        { id: 'c', timestamp: '2026-09-14T23:59:00.000Z' },
        { id: 'd', timestamp: OLDER },
        { id: 'e', timestamp: '2026-09-12T08:00:00.000Z' },
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
