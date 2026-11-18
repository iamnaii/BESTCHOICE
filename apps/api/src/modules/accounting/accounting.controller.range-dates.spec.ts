import { BadRequestException } from '@nestjs/common';
import { AccountingController } from './accounting.controller';

/**
 * ช่วงวันที่ของ ledger/bad-debt · ledger/general-journal · inter-co/report (2026-11-18)
 * วันเริ่ม 2026-11-01 = 2026-10-31T17:00:00.000Z · วันสิ้นสุด 2026-11-17 = 2026-11-17T16:59:59.999Z
 *
 * เดิมใช้ new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ ตัดรายการ 00:00–06:59 น. ของวันเริ่ม (รายการตั้งลูกหนี้งวด
 * ลงเที่ยงคืนไทยของวันครบกำหนด) และตัดทุกรายการหลัง 07:00 น. ของวันสิ้นสุด
 */
describe('AccountingController — ช่วงวันที่ bad-debt / general-journal / inter-co', () => {
  const START = '2026-10-31T17:00:00.000Z';
  const END = '2026-11-17T16:59:59.999Z';
  const service = { getBadDebtReport: jest.fn(), getGeneralJournal: jest.fn() };
  const intercoReportService = { getReport: jest.fn() };
  const controller = new AccountingController(
    service as never,
    {} as never,
    {} as never,
    intercoReportService as never,
  );
  const iso = (d: Date) => d.toISOString();

  beforeEach(() => jest.clearAllMocks());

  const endpoints = [
    ['bad-debt', () => controller.getBadDebtReport('2026-11-01', '2026-11-17'), service.getBadDebtReport],
    ['general-journal', () => controller.getGeneralJournal('2026-11-01', '2026-11-17'), service.getGeneralJournal],
    ['inter-co/report', () => controller.getInterCoReport('2026-11-01', '2026-11-17'), intercoReportService.getReport],
  ] as const;

  it.each(endpoints)('%s: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', (_name, call, mock) => {
    call();
    const [from, to] = (mock as jest.Mock).mock.calls[0];
    expect(iso(from)).toBe(START);
    expect(iso(to)).toBe(END);
  });

  it.each(endpoints)(
    '%s: รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง',
    (_name, call, mock) => {
      call();
      const [from, to] = (mock as jest.Mock).mock.calls[0];
      const accrualOnStartDay = new Date('2026-11-01T00:00:00+07:00');
      const afternoonOnEndDay = new Date('2026-11-17T14:00:00+07:00');
      const accrualOnNextDay = new Date('2026-11-18T00:00:00+07:00');
      expect(accrualOnStartDay >= from && accrualOnStartDay <= to).toBe(true);
      expect(afternoonOnEndDay <= to).toBe(true);
      expect(accrualOnNextDay <= to).toBe(false);
    },
  );

  it.each(endpoints)('%s: ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็ม) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', (name, _call, mock) => {
    const run = {
      'bad-debt': () => controller.getBadDebtReport('2026-11-01T03:00:00.000Z', '2026-11-17T03:04:05.000Z'),
      'general-journal': () => controller.getGeneralJournal('2026-11-01T03:00:00.000Z', '2026-11-17T03:04:05.000Z'),
      'inter-co/report': () => controller.getInterCoReport('2026-11-01T03:00:00.000Z', '2026-11-17T03:04:05.000Z'),
    }[name];
    run();
    const [from, to] = (mock as jest.Mock).mock.calls[0];
    expect(iso(from)).toBe('2026-11-01T03:00:00.000Z');
    expect(iso(to)).toBe('2026-11-17T03:04:05.000Z');
  });

  it('bad-debt: ส่ง companyId ต่อให้ service', () => {
    controller.getBadDebtReport('2026-11-01', '2026-11-17', 'co-1');
    expect(service.getBadDebtReport.mock.calls[0][2]).toBe('co-1');
  });

  it('general-journal: หน้า/จำนวนต่อหน้า/บริษัทส่งต่อเหมือนเดิม', () => {
    controller.getGeneralJournal('2026-11-01', '2026-11-17', '2', '25', 'co-1');
    expect(service.getGeneralJournal.mock.calls[0][2]).toEqual({ page: 2, limit: 25, companyId: 'co-1' });
  });

  it('bad-debt: ไม่ส่ง start หรือ end = 400 ภาษาไทย (เดิมส่ง Invalid Date เข้า Prisma)', () => {
    expect(() => controller.getBadDebtReport(undefined as never, '2026-11-17')).toThrow(BadRequestException);
    expect(() => controller.getBadDebtReport('2026-11-01', '')).toThrow(/กรุณาระบุ/);
    expect(service.getBadDebtReport).not.toHaveBeenCalled();
  });

  it('general-journal: ไม่ส่ง start หรือ end = 400 ภาษาไทย (เดิมส่ง Invalid Date เข้า Prisma)', () => {
    expect(() => controller.getGeneralJournal('2026-11-01', undefined as never)).toThrow(BadRequestException);
    expect(() => controller.getGeneralJournal('', '2026-11-17')).toThrow(/กรุณาระบุ/);
    expect(service.getGeneralJournal).not.toHaveBeenCalled();
  });

  it('inter-co/report: ไม่ส่ง start หรือ end = 400 เหมือนเดิม', () => {
    expect(() => controller.getInterCoReport('2026-11-01', undefined as never)).toThrow(BadRequestException);
    expect(intercoReportService.getReport).not.toHaveBeenCalled();
  });
});
