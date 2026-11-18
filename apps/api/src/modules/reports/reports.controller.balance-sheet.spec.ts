import { ReportsController } from './reports.controller';

/**
 * GET /reports/balance-sheet — ไม่ส่ง asOfDate ⇒ ใช้ "วันนี้ตามเวลาไทย" (2026-11-18)
 * เดิม new Date().toISOString().split('T')[0] = วันที่ UTC ⇒ 00:00–06:59 น. ไทยได้ "เมื่อวาน"
 * ปั้น service ด้วยมือแบบ accounting.controller.report-dates.spec.ts · จำลองเวลาเฉพาะ Date
 */
const FAKE_DATE_ONLY = [
  'nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance',
] as const;

describe('ReportsController.getBalanceSheet — ค่าตั้งต้น asOfDate', () => {
  const reportsService = {
    resolveCompanyBranches: jest.fn().mockResolvedValue(undefined),
    getBalanceSheet: jest.fn().mockResolvedValue({}),
  };
  const controller = new ReportsController(reportsService as never);

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('03:30 น. ไทยของวันที่ 18 พ.ย. (= 20:30Z ของวันที่ 17) → งบ ณ 2026-11-18', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T20:30:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    await controller.getBalanceSheet(undefined);
    expect(reportsService.getBalanceSheet).toHaveBeenCalledWith('2026-11-18', undefined, undefined);
  });

  it('23:30 น. ไทยของวันที่ 17 พ.ย. (= 16:30Z วันเดียวกัน) → งบ ณ 2026-11-17', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T16:30:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    await controller.getBalanceSheet(undefined);
    expect(reportsService.getBalanceSheet).toHaveBeenCalledWith('2026-11-17', undefined, undefined);
  });

  it('ส่ง asOfDate มาเอง → ใช้ค่านั้นตามเดิม', async () => {
    await controller.getBalanceSheet('2026-10-31');
    expect(reportsService.getBalanceSheet).toHaveBeenCalledWith('2026-10-31', undefined, undefined);
  });
});
