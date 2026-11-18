import { AccountingController } from './accounting.controller';

/**
 * endpoint ledger/* ต้องส่งขอบวันตามเวลาไทยให้ service (2026-11-18)
 * 2026-11-01 เริ่ม = 2026-10-31T17:00:00.000Z · 2026-11-17 สิ้นสุด = 2026-11-17T16:59:59.999Z
 */
describe('AccountingController — วันที่ของรายงาน ledger/*', () => {
  const START = '2026-10-31T17:00:00.000Z';
  const END = '2026-11-17T16:59:59.999Z';
  const service = {
    getTrialBalance: jest.fn(),
    getProfitLossFromJournal: jest.fn(),
    getBalanceSheetFromJournal: jest.fn(),
    getCashFlowFromJournal: jest.fn(),
    getEquityStatementFromJournal: jest.fn(),
    getGeneralLedger: jest.fn(),
  };
  const controller = new AccountingController(service as never, {} as never, {} as never, {} as never);
  const iso = (d: Date) => d.toISOString();

  beforeEach(() => jest.clearAllMocks());

  it('งบทดลอง ณ วันที่: ตัดยอดสิ้นวันไทย', () => {
    controller.getTrialBalance('2026-11-17');
    expect(iso(service.getTrialBalance.mock.calls[0][0])).toBe(END);
    expect(service.getTrialBalance.mock.calls[0][1]).toBe('FINANCE');
  });

  it('งบทดลองหน้าร้าน: ตัดยอดสิ้นวันไทย', () => {
    controller.getShopTrialBalance('2026-11-17');
    expect(iso(service.getTrialBalance.mock.calls[0][0])).toBe(END);
    expect(service.getTrialBalance.mock.calls[0][1]).toBe('SHOP');
  });

  it('งบฐานะการเงิน: ตัดยอดสิ้นวันไทย', () => {
    controller.getBalanceSheetFromJournal('2026-11-17');
    expect(iso(service.getBalanceSheetFromJournal.mock.calls[0][0])).toBe(END);
  });

  it('ไม่ส่งวันที่ = undefined ตามเดิม', () => {
    controller.getTrialBalance();
    controller.getBalanceSheetFromJournal();
    expect(service.getTrialBalance.mock.calls[0][0]).toBeUndefined();
    expect(service.getBalanceSheetFromJournal.mock.calls[0][0]).toBeUndefined();
  });

  it.each([
    ['งบกำไรขาดทุน', () => controller.getProfitLossFromJournal('2026-11-01', '2026-11-17'), service.getProfitLossFromJournal, 0],
    ['งบกำไรขาดทุนหน้าร้าน', () => controller.getShopProfitLoss('2026-11-01', '2026-11-17'), service.getProfitLossFromJournal, 0],
    ['งบกระแสเงินสด', () => controller.getCashFlowFromJournal('2026-11-01', '2026-11-17'), service.getCashFlowFromJournal, 0],
    ['งบส่วนของผู้ถือหุ้น', () => controller.getEquityStatementFromJournal('2026-11-01', '2026-11-17'), service.getEquityStatementFromJournal, 0],
    ['บัญชีแยกประเภท', () => controller.getGeneralLedger('11-1201', '2026-11-01', '2026-11-17'), service.getGeneralLedger, 1],
  ] as const)('%s: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', (_name, call, mock, startIndex) => {
    call();
    const args = (mock as jest.Mock).mock.calls[0];
    expect(iso(args[startIndex])).toBe(START);
    expect(iso(args[startIndex + 1])).toBe(END);
  });
});
