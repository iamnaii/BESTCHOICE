import { describe, it, expect } from 'vitest';
import { deriveTabCounts, deriveChannelCounts } from './tab-counts';

const S = (over: Partial<{ assignedTo: { id: string } | null; waitingSince: string | null }>) => ({
  assignedTo: null,
  waitingSince: null,
  ...over,
});

describe('deriveTabCounts', () => {
  it('นับตามความหมายของแต่ละแท็บ ไม่ใช่ "ยังไม่อ่าน" ชุดเดียวทั้งหมด', () => {
    const sessions = [
      S({ assignedTo: { id: 'me' }, waitingSince: '2026-09-05T01:00:00Z' }),
      S({ assignedTo: { id: 'other' } }),
      S({ assignedTo: { id: 'me' }, waitingSince: '2026-09-05T02:00:00Z' }),
      S({ assignedTo: null }),
    ];
    // ทั้งหมด = ทุกแถว · ของฉัน = ห้องที่ฉันดูแลทุกห้อง · รอตอบ = ห้องที่ลูกค้ารอ
    expect(deriveTabCounts(sessions, 'me')).toEqual({ mine: 2, all: 4, waiting: 2 });
  });

  it('ไม่รู้ว่าใครถาม → ของฉันเป็นศูนย์ ไม่ใช่ห้องที่ยังไม่มีเจ้าของ', () => {
    const sessions = [S({ assignedTo: null }), S({ assignedTo: { id: 'someone' } })];
    expect(deriveTabCounts(sessions, undefined)).toEqual({ mine: 0, all: 2, waiting: 0 });
  });

  it('รายการว่าง', () => {
    expect(deriveTabCounts([], 'me')).toEqual({ mine: 0, all: 0, waiting: 0 });
  });
});

describe('deriveChannelCounts', () => {
  it('นับทุกห้องที่แสดงอยู่ต่อช่องทาง ไม่ใช่เฉพาะห้องที่ยังไม่อ่าน', () => {
    const sessions = [
      { channel: 'LINE_FINANCE' },
      { channel: 'LINE_FINANCE' },
      { channel: 'FACEBOOK' },
      { channel: 'FACEBOOK' },
      { channel: 'WEB' },
    ];
    expect(deriveChannelCounts(sessions)).toEqual({ LINE_FINANCE: 2, FACEBOOK: 2, WEB: 1 });
  });

  it('ห้องที่ไม่มีช่องทางถูกข้าม', () => {
    expect(deriveChannelCounts([{ channel: undefined }])).toEqual({});
  });
});
