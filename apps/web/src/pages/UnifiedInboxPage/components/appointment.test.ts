import { describe, expect, it } from 'vitest';
import { apptState, formatDurationTh, nextAppointment } from './appointment';

const NOW = new Date('2026-09-06T10:00:00+07:00');
const at = (iso: string) => new Date(iso).toISOString();

describe('apptState — ป้ายนัดตามความใกล้', () => {
  it.each([
    ['เลยนัด', at('2026-09-06T09:20:00+07:00'), 'overdue', 'เลยนัด 40 นาที', true],
    ['ถึงเวลาพอดี (±1 นาที)', at('2026-09-06T10:00:30+07:00'), 'due', 'ถึงเวลานัดแล้ว', true],
    ['ใกล้ถึง ≤15 นาที', at('2026-09-06T10:12:00+07:00'), 'soon', 'นัดอีก 12 นาที', true],
    ['วันนี้แต่ยังอีกนาน', at('2026-09-06T15:30:00+07:00'), 'today', 'นัดวันนี้ 15:30', false],
    ['พรุ่งนี้', at('2026-09-07T07:00:00+07:00'), 'tomorrow', 'นัดพรุ่งนี้ 07:00', false],
    ['วันอื่น', at('2026-09-12T13:00:00+07:00'), 'later', 'นัด 12 ก.ย. 13:00', false],
  ])('%s', (_n, due, kind, label, urgent) => {
    const st = apptState(due, NOW)!;
    expect(st.kind).toBe(kind);
    expect(st.label).toBe(label);
    expect(st.urgent).toBe(urgent);
  });

  it('ไม่มีวันนัด / วันเพี้ยน → null', () => {
    expect(apptState(null, NOW)).toBeNull();
    expect(apptState('not-a-date', NOW)).toBeNull();
  });

  it('16 นาที = ยังไม่ urgent (ขอบ 15 นาทีของ OBI)', () => {
    expect(apptState(at('2026-09-06T10:16:00+07:00'), NOW)!.urgent).toBe(false);
  });
});

describe('formatDurationTh', () => {
  it.each([[5 * 60_000, '5 นาที'], [125 * 60_000, '2 ชม. 5 นาที'], [3 * 3600_000, '3 ชม.'], [49 * 3600_000, '2 วัน']])('%d → %s', (ms, s) => {
    expect(formatDurationTh(ms)).toBe(s);
  });
});

describe('nextAppointment', () => {
  it('ข้ามใบที่เสร็จแล้ว/ไม่มีวัน แล้วเอาใบใกล้สุด', () => {
    expect(
      nextAppointment([
        { id: 'a', title: 'x', dueDate: '2026-09-08T00:00:00Z', status: 'TODO' },
        { id: 'b', title: 'y', dueDate: '2026-09-07T00:00:00Z', status: 'DONE' },
        { id: 'c', title: 'z', dueDate: null, status: 'TODO' },
        { id: 'd', title: 'w', dueDate: '2026-09-07T12:00:00Z', status: 'DOING' },
      ])?.id,
    ).toBe('d');
    expect(nextAppointment([])).toBeNull();
    expect(nextAppointment(undefined)).toBeNull();
  });
});
