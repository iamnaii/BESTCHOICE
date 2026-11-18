import { ReportsController } from './reports.controller';

/**
 * ปี/เดือนค่าตั้งต้นของรายงาน (2026-11-18): ไม่ส่ง year/month ⇒ ใช้ปีเดือนตามปฏิทินไทย ไม่ใช่ของ TZ โปรเซส
 * เดิม new Date().getFullYear()/getMonth() — 2026-12-31T18:00Z = 1 ม.ค. 2027 เวลาไทย แต่โปรเซส UTC ได้ 2026/12
 * จำลองเวลาเฉพาะ Date (แบบเดียวกับ reports.controller.balance-sheet.spec.ts)
 */
const FAKE_DATE_ONLY = [
  'nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance',
] as const;

describe('ReportsController — ปี/เดือนค่าตั้งต้นตามเวลาไทย', () => {
  const reportsService = {
    resolveCompanyBranches: jest.fn().mockResolvedValue(undefined),
    shouldIncludeFinanceExpenses: jest.fn().mockResolvedValue(true),
    getMonthlyPLSummary: jest.fn().mockResolvedValue({}),
    getComparativePL: jest.fn().mockResolvedValue({}),
    getQuarterlyReport: jest.fn().mockResolvedValue({}),
  };
  const controller = new ReportsController(reportsService as never);
  const owner = { role: 'OWNER', branchId: null };
  const manager = { role: 'BRANCH_MANAGER', branchId: 'b1' };

  beforeEach(() => {
    // 2027-01-01 01:00 เวลาไทย
    jest.useFakeTimers({ now: new Date('2026-12-31T18:00:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('monthly-pl (ผู้จัดการสาขา) ไม่ส่งปี → 2027', async () => {
    await controller.getMonthlyPL(undefined as never, manager);
    expect(reportsService.getMonthlyPLSummary.mock.calls[0][0]).toBe(2027);
  });

  it('monthly-pl (ทั้งบริษัท) ไม่ส่งปี → 2027', async () => {
    await controller.getMonthlyPL(undefined as never, owner);
    expect(reportsService.getMonthlyPLSummary.mock.calls[0][0]).toBe(2027);
  });

  it('comparative-pl ไม่ส่งปี/เดือน → 2027 เดือน 1 (เดือนแบบ 1-based เหมือนเดิม)', async () => {
    await controller.getComparativePL(undefined as never, undefined as never, owner);
    expect(reportsService.getComparativePL.mock.calls[0].slice(0, 2)).toEqual([2027, 1]);
  });

  it('quarterly ไม่ส่งปี → 2027', async () => {
    await controller.getQuarterly(undefined as never, undefined as never, owner);
    expect(reportsService.getQuarterlyReport.mock.calls[0].slice(0, 2)).toEqual([2027, 1]);
  });

  it('ส่งปี/เดือนมาเอง → ใช้ค่านั้นตามเดิม', async () => {
    await controller.getComparativePL('2026', '7', owner);
    expect(reportsService.getComparativePL.mock.calls[0].slice(0, 2)).toEqual([2026, 7]);
  });
});
