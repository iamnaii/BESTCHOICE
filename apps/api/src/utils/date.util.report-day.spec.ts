import { BadRequestException } from '@nestjs/common';
import { reportAsOf, reportDayEnd, reportDayStart } from './date.util';

/**
 * รายงานบัญชีรับวันที่แบบ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม controller ใช้ new Date('YYYY-MM-DD') = เที่ยงคืน UTC = 07:00 น. ไทย ⇒ รายการ 00:00–06:59 น.
 * ของวันเริ่ม (เช่น รายการตั้งลูกหนี้งวดที่ลงเที่ยงคืนไทยของวันครบกำหนด) ตกนอกช่วง และงบ ณ วันที่
 * ไม่นับรายการหลัง 07:00 น. ของวันที่เลือก
 */
describe('report day helpers', () => {
  it('reportDayStart: YYYY-MM-DD = 00:00 น. เวลาไทย', () => {
    expect(reportDayStart('2026-11-01').toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('reportDayEnd: YYYY-MM-DD = 23:59:59.999 น. เวลาไทย', () => {
    expect(reportDayEnd('2026-11-17').toISOString()).toBe('2026-11-17T16:59:59.999Z');
  });

  it('reportAsOf: YYYY-MM-DD = สิ้นวันไทยของวันนั้น', () => {
    expect(reportAsOf('2026-11-17').toISOString()).toBe('2026-11-17T16:59:59.999Z');
  });

  it('รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · รายการเที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', () => {
    const start = reportDayStart('2026-11-01');
    const end = reportDayEnd('2026-11-30');
    const dueOnFirst = new Date('2026-11-01T00:00:00+07:00');
    const dueOnNextFirst = new Date('2026-12-01T00:00:00+07:00');
    expect(dueOnFirst >= start && dueOnFirst <= end).toBe(true);
    expect(dueOnNextFirst <= end).toBe(false);
  });

  it('วันที่ไม่มีจริง = 400 ภาษาไทย', () => {
    expect(() => reportDayStart('2026-02-31')).toThrow(BadRequestException);
    expect(() => reportDayEnd('2026-02-31')).toThrow(BadRequestException);
    expect(() => reportAsOf('2026-02-31')).toThrow(BadRequestException);
  });

  it('ค่าที่ไม่ใช่ YYYY-MM-DD ได้พฤติกรรมเดิม', () => {
    const iso = '2026-11-17T03:04:05.000Z';
    expect(reportDayStart(iso).toISOString()).toBe(iso);
    expect(reportAsOf(iso).toISOString()).toBe(iso);
    const legacyEnd = new Date(iso);
    legacyEnd.setHours(23, 59, 59, 999);
    expect(reportDayEnd(iso).getTime()).toBe(legacyEnd.getTime());
  });
});
