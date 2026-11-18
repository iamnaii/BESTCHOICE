import { PaymentsController } from './payments.controller';

/**
 * GET /payments/daily-summary · /daily-summary/dates — ไม่ส่ง date/month ⇒ ใช้ "วันนี้/เดือนนี้ตามเวลาไทย" (2026-11-18)
 * เดิมใช้วันที่ UTC ⇒ 00:00–06:59 น. ไทย ได้เมื่อวาน (คืนวันที่ 1 ได้เดือนก่อน)
 * จำลองเวลาเฉพาะ Date · ปั้น PaymentsService ด้วยมือ
 */
const FAKE_DATE_ONLY = [
  'nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance',
] as const;

describe('PaymentsController — ค่าตั้งต้นของสมุดสรุปรายวัน', () => {
  const paymentsService = {
    getDailySummary: jest.fn().mockResolvedValue({}),
    getDailySummaryDates: jest.fn().mockResolvedValue({}),
  };
  const controller = new PaymentsController(
    paymentsService as never,
    {} as never,
    {} as never,
    {} as never,
  );

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('daily-summary ไม่ส่ง date: 03:30 น. ไทยของวันที่ 18 พ.ย. → สมุดของ 2026-11-18', () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T20:30:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    controller.getDailySummary('');
    expect(paymentsService.getDailySummary).toHaveBeenCalledWith('2026-11-18', undefined, undefined, undefined);
  });

  it('daily-summary ส่ง date มาเอง → ใช้ค่านั้น', () => {
    controller.getDailySummary('2026-10-31');
    expect(paymentsService.getDailySummary).toHaveBeenCalledWith('2026-10-31', undefined, undefined, undefined);
  });

  it('daily-summary/dates ไม่ส่ง month: 01:00 น. ไทยของวันที่ 1 ธ.ค. (= 18:00Z ของ 30 พ.ย.) → เดือน 2026-12', () => {
    jest.useFakeTimers({ now: new Date('2026-11-30T18:00:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    controller.getDailySummaryDates('');
    expect(paymentsService.getDailySummaryDates).toHaveBeenCalledWith('2026-12', undefined);
  });

  it('daily-summary/dates ส่ง month มาเอง → ใช้ค่านั้น', () => {
    controller.getDailySummaryDates('2026-09');
    expect(paymentsService.getDailySummaryDates).toHaveBeenCalledWith('2026-09', undefined);
  });
});
