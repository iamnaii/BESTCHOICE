import { describe, expect, it } from 'vitest';
import { apptState, formatDurationTh, nextAppointment } from './appointment';

// สร้างเวลาทั้งหมดจาก "ตอนนี้" ในโซนของเครื่องที่รัน (CI = UTC · เครื่องเรา = ไทย · ที่ไหนก็ได้)
// จะได้ไม่มีเคสที่ข้ามวันเพราะโซน — ป้ายพิมพ์เวลา local ด้วยตัวจัดรูปเดียวกับโค้ด
const NOW = new Date(2026, 8, 6, 10, 0, 0); // 6 ก.ย. 2026 10:00 local
const shiftMin = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();
const atLocal = (dayOffset: number, h: number, mi: number) => {
  const d = new Date(NOW);
  d.setDate(NOW.getDate() + dayOffset);
  d.setHours(h, mi, 0, 0);
  return d.toISOString();
};
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const dmy = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${TH[d.getMonth()]}`;
};

describe('apptState — ป้ายนัดตามความใกล้', () => {
  const today = atLocal(0, 15, 30);
  const tomorrow = atLocal(1, 7, 0);
  const later = atLocal(6, 13, 0);
  it.each([
    ['เลยนัด', shiftMin(-40), 'overdue', 'เลยนัด 40 นาที', true],
    ['ถึงเวลาพอดี (±1 นาที)', shiftMin(0.5), 'due', 'ถึงเวลานัดแล้ว', true],
    ['ใกล้ถึง ≤15 นาที', shiftMin(12), 'soon', 'นัดอีก 12 นาที', true],
    ['วันนี้แต่ยังอีกนาน', today, 'today', `นัดวันนี้ ${hhmm(today)}`, false],
    ['พรุ่งนี้', tomorrow, 'tomorrow', `นัดพรุ่งนี้ ${hhmm(tomorrow)}`, false],
    ['วันอื่น', later, 'later', `นัด ${dmy(later)} ${hhmm(later)}`, false],
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
    expect(apptState(shiftMin(16), NOW)!.urgent).toBe(false);
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
