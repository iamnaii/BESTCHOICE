import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CustomerJourneyCron } from './customer-journey.cron';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

describe('CustomerJourneyCron', () => {
  const state = {
    recomputeContinuing: jest.fn().mockResolvedValue({ recomputed: 2, failedBatches: 0 }),
    recomputeAll: jest.fn().mockResolvedValue({ recomputed: 9000, failedBatches: 0 }),
    activeCustomerIdsSince: jest.fn().mockResolvedValue(['c1', 'c2']),
    purchasedParity: jest.fn().mockResolvedValue({ purchasedStates: 10, bought: 10 }),
    contractsMissingActivationEntry: jest.fn().mockResolvedValue([]),
  };
  const cron = new CustomerJourneyCron(state as any);

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('วันธรรมดา 03:30 น. → คำนวณเฉพาะคนที่ขยับใน 48 ชม. · PURCHASED ตรง → ไม่เตือน', async () => {
    const now = new Date('2026-09-15T20:30:00.000Z'); // พุธ 16 ก.ย. 03:30 น. เวลาไทย
    await expect(cron.recomputeDaily(now)).resolves.toEqual({ mode: 'active', recomputed: 2, failedBatches: 0, purchasedStates: 10, bought: 10 });
    expect(state.activeCustomerIdsSince).toHaveBeenCalledWith(new Date('2026-09-13T20:30:00.000Z'));
    expect(state.recomputeContinuing).toHaveBeenCalledWith(['c1', 'c2']);
    expect(state.recomputeAll).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('วันอาทิตย์ (เวลาไทย) → คำนวณทุกคน · PURCHASED ไม่ตรง BOUGHT_WHERE → Sentry error', async () => {
    state.purchasedParity.mockResolvedValueOnce({ purchasedStates: 9, bought: 10 });
    const now = new Date('2026-09-19T20:30:00.000Z'); // อาทิตย์ 20 ก.ย. 03:30 น. เวลาไทย
    await expect(cron.recomputeDaily(now)).resolves.toMatchObject({ mode: 'sweep', recomputed: 9000, failedBatches: 0 });
    expect(state.activeCustomerIdsSince).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'journey:recompute แคช PURCHASED ไม่เท่ากับ BOUGHT_WHERE',
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('บางชุดล้ม → ไม่โยน · คืน failedBatches · ด่าน parity ยังรัน', async () => {
    state.recomputeContinuing.mockResolvedValueOnce({ recomputed: 1200, failedBatches: 1 });
    await expect(cron.recomputeDaily(new Date('2026-09-15T20:30:00.000Z'))).resolves.toEqual({
      mode: 'active',
      recomputed: 1200,
      failedBatches: 1,
      purchasedStates: 10,
      bought: 10,
    });
    expect(state.purchasedParity).toHaveBeenCalledTimes(1);
  });

  it('หา id ที่ขยับไม่ได้ → Sentry.captureException · ยังเทียบ parity ก่อน แล้วค่อยโยนต่อ', async () => {
    state.activeCustomerIdsSince.mockRejectedValueOnce(new Error('boom'));
    state.purchasedParity.mockResolvedValueOnce({ purchasedStates: 9, bought: 10 });
    await expect(cron.recomputeDaily(new Date('2026-09-15T20:30:00.000Z'))).rejects.toThrow('boom');
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }), expect.anything());
    expect(state.purchasedParity).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'journey:recompute แคช PURCHASED ไม่เท่ากับ BOUGHT_WHERE',
      expect.objectContaining({ extra: expect.objectContaining({ recomputed: 0, failedBatches: 0 }) }),
    );
  });

  it('parity เองล้ม → Sentry แล้วโยน error ของ parity', async () => {
    state.purchasedParity.mockRejectedValueOnce(new Error('parity down'));
    await expect(cron.recomputeDaily(new Date('2026-09-15T20:30:00.000Z'))).rejects.toThrow('parity down');
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'parity down' }), expect.anything());
  });

  it('entry-guard 04:00 น. ตรวจช่วง "เมื่อวาน" เวลาไทย · มีสัญญาขาด entry → Sentry error พร้อมจำนวน', async () => {
    state.contractsMissingActivationEntry.mockResolvedValueOnce(['k2']);
    await expect(cron.entryGuard(new Date('2026-09-15T21:00:00.000Z'))).resolves.toEqual({ missing: 1 });
    expect(state.contractsMissingActivationEntry).toHaveBeenCalledWith({
      gte: new Date('2026-09-14T17:00:00.000Z'),
      lt: new Date('2026-09-15T17:00:00.000Z'),
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'journey:entry-guard hook CONTRACT_ACTIVATED หลุด',
      expect.objectContaining({ level: 'error', extra: { day: '2026-09-15', missing: 1, contractIds: ['k2'] } }),
    );
  });
});
