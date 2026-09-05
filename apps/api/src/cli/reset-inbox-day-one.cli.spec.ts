import { computeWaitingSince } from './reset-inbox-day-one.cli';

const at = (iso: string) => new Date(iso);

describe('computeWaitingSince — เวลาข้อความลูกค้าใบแรกหลังคำตอบล่าสุด', () => {
  it('ลูกค้าส่ง 2 ใบหลังพนักงานตอบ → ได้เวลาใบแรก (ไม่ใช่ใบล่าสุด)', () => {
    const msgs = [
      { role: 'CUSTOMER', createdAt: at('2026-09-01T01:00:00Z') },
      { role: 'STAFF', createdAt: at('2026-09-01T02:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-03T05:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-03T06:00:00Z') },
    ];
    expect(computeWaitingSince(msgs)).toEqual(at('2026-09-03T05:00:00Z'));
  });

  it('ไม่มี STAFF เลย → ข้อความแรกของห้อง', () => {
    const msgs = [
      { role: 'CUSTOMER', createdAt: at('2026-09-02T01:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-02T02:00:00Z') },
    ];
    expect(computeWaitingSince(msgs)).toEqual(at('2026-09-02T01:00:00Z'));
  });

  it('ข้อความสุดท้ายเป็น STAFF → null (ไม่ได้รอ)', () => {
    expect(computeWaitingSince([
      { role: 'CUSTOMER', createdAt: at('2026-09-02T01:00:00Z') },
      { role: 'STAFF', createdAt: at('2026-09-02T01:30:00Z') },
    ])).toBeNull();
    expect(computeWaitingSince([])).toBeNull();
  });

  it('BOT ไม่นับเป็นคำตอบ — ข้อความสุดท้ายเป็น BOT ก็ยังถือว่ารอคนอยู่', () => {
    expect(computeWaitingSince([
      { role: 'CUSTOMER', createdAt: at('2026-09-02T01:00:00Z') },
      { role: 'BOT', createdAt: at('2026-09-02T01:30:00Z') },
    ])).toEqual(at('2026-09-02T01:00:00Z'));
  });

  it('ประวัติผสม STAFF ตอบแล้ว ตามด้วย BOT แทรก → ยังนับจากใบลูกค้าแรกหลัง STAFF', () => {
    const msgs = [
      { role: 'CUSTOMER', createdAt: at('2026-09-01T01:00:00Z') },
      { role: 'STAFF', createdAt: at('2026-09-01T02:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-03T05:00:00Z') },
      { role: 'BOT', createdAt: at('2026-09-03T05:30:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-03T06:00:00Z') },
    ];
    expect(computeWaitingSince(msgs)).toEqual(at('2026-09-03T05:00:00Z'));
  });

  it('SYSTEM/AUTO_TRIGGER ไม่นับเป็นคำตอบ', () => {
    const withSystem = [
      { role: 'STAFF', createdAt: at('2026-09-01T02:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-03T05:00:00Z') },
      { role: 'SYSTEM', createdAt: at('2026-09-03T05:01:00Z') },
    ];
    expect(computeWaitingSince(withSystem)).toEqual(at('2026-09-03T05:00:00Z'));

    const withAutoTrigger = [
      { role: 'STAFF', createdAt: at('2026-09-01T02:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-03T05:00:00Z') },
      { role: 'AUTO_TRIGGER', createdAt: at('2026-09-03T05:01:00Z') },
    ];
    expect(computeWaitingSince(withAutoTrigger)).toEqual(at('2026-09-03T05:00:00Z'));
  });
});
