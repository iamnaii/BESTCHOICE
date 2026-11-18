import { BadRequestException } from '@nestjs/common';
import { ConsolidatedController } from './consolidated.controller';

/**
 * รายงานงบรวม SHOP+FINANCE รับวันที่ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ งบทดลอง/แดชบอร์ด ณ วันที่ ไม่นับรายการหลัง 07:00 น. ของวันนั้น
 * และกำไรขาดทุนตัดรายการ 00:00–06:59 น. ของวันเริ่ม
 */
describe('ConsolidatedController — วันที่ของรายงาน', () => {
  const START = '2026-10-31T17:00:00.000Z';
  const END = '2026-11-17T16:59:59.999Z';
  const svc = {
    getConsolidatedTrialBalance: jest.fn(),
    getConsolidatedProfitLoss: jest.fn(),
    getConsolidatedDashboard: jest.fn(),
  };
  const controller = new ConsolidatedController(svc as never);
  const iso = (d: Date) => d.toISOString();

  beforeEach(() => jest.clearAllMocks());

  it('trial-balance: ตัดยอดสิ้นวันไทยของ asOf', () => {
    controller.trialBalance('2026-11-17');
    expect(iso(svc.getConsolidatedTrialBalance.mock.calls[0][0])).toBe(END);
  });

  it('dashboard: ตัดยอดสิ้นวันไทยของ asOf', () => {
    controller.dashboard('2026-11-17');
    expect(iso(svc.getConsolidatedDashboard.mock.calls[0][0])).toBe(END);
  });

  it('trial-balance / dashboard: ไม่ส่ง asOf = undefined ตามเดิม (service ใช้ตอนนี้)', () => {
    controller.trialBalance();
    controller.dashboard();
    expect(svc.getConsolidatedTrialBalance.mock.calls[0][0]).toBeUndefined();
    expect(svc.getConsolidatedDashboard.mock.calls[0][0]).toBeUndefined();
  });

  it('profit-loss: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', () => {
    controller.profitLoss('2026-11-01', '2026-11-17');
    const [from, to] = svc.getConsolidatedProfitLoss.mock.calls[0];
    expect(iso(from)).toBe(START);
    expect(iso(to)).toBe(END);
  });

  it('profit-loss: รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', () => {
    controller.profitLoss('2026-11-01', '2026-11-17');
    const [from, to] = svc.getConsolidatedProfitLoss.mock.calls[0];
    const onStartDay = new Date('2026-11-01T00:00:00+07:00');
    const onNextDay = new Date('2026-11-18T00:00:00+07:00');
    expect(onStartDay >= from && onStartDay <= to).toBe(true);
    expect(onNextDay <= to).toBe(false);
  });

  it('profit-loss: ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็ม) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', () => {
    controller.profitLoss('2026-11-01T03:00:00.000Z', '2026-11-17T03:04:05.000Z');
    const [from, to] = svc.getConsolidatedProfitLoss.mock.calls[0];
    expect(iso(from)).toBe('2026-11-01T03:00:00.000Z');
    expect(iso(to)).toBe('2026-11-17T03:04:05.000Z');
  });

  it('profit-loss: ไม่ส่ง start หรือ end = 400 ภาษาไทย (เดิมส่ง Invalid Date)', () => {
    expect(() => controller.profitLoss(undefined as never, '2026-11-17')).toThrow(BadRequestException);
    expect(() => controller.profitLoss('2026-11-01', '')).toThrow(/กรุณาระบุ/);
    expect(svc.getConsolidatedProfitLoss).not.toHaveBeenCalled();
  });
});
