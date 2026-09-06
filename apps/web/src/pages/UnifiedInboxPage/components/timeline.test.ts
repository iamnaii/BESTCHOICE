import { describe, it, expect } from 'vitest';
import { mergeTimeline } from './timeline';

const m = (id: string, at: string) => ({ id, createdAt: at, text: id });
const n = (id: string, at: string) => ({ id, createdAt: at, content: id });

describe('mergeTimeline — ข้อความ + โน้ตภายใน เรียงตามเวลา', () => {
  it('แทรกโน้ตตามเวลาระหว่างข้อความ', () => {
    const out = mergeTimeline([m('a', '2026-09-05T10:00:00Z'), m('b', '2026-09-05T12:00:00Z')], [n('x', '2026-09-05T11:00:00Z')]);
    expect(out.map((i) => i.id)).toEqual(['a', 'note-x', 'b']);
  });
  it('โน้ตเก่ากว่าข้อความเก่าสุดที่โหลดมา → ตัดออก (หน้าต่าง 100 ข้อความ)', () => {
    const out = mergeTimeline([m('a', '2026-09-05T10:00:00Z')], [n('old', '2026-09-01T00:00:00Z'), n('new', '2026-09-05T10:30:00Z')]);
    expect(out.map((i) => i.id)).toEqual(['a', 'note-new']);
  });
  it('ไม่มีข้อความเลย → แสดงโน้ตทั้งหมด', () => {
    const out = mergeTimeline([], [n('x', '2026-09-01T00:00:00Z'), n('y', '2026-09-02T00:00:00Z')]);
    expect(out.map((i) => i.id)).toEqual(['note-x', 'note-y']);
  });
  it('เวลาเท่ากัน: ข้อความมาก่อนโน้ต', () => {
    const out = mergeTimeline([m('a', '2026-09-05T10:00:00Z')], [n('x', '2026-09-05T10:00:00Z')]);
    expect(out.map((i) => i.kind)).toEqual(['message', 'note']);
  });
});
