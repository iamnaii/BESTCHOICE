import * as Sentry from '@sentry/nestjs';
import { emitDeferredWarnings, warningsOf } from './deferred-warning';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

describe('deferred-warning — สัญญาณเตือนที่ส่งหลังธุรกรรม commit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ข้อความ → captureMessage ระดับ warning พร้อม tags/extra · exception → captureException', () => {
    const err = new Error('builder failed');
    emitDeferredWarnings([
      { message: 'm1', tags: { action: 'a1' }, extra: { k: 1 } },
      { message: 'm2', tags: { action: 'a2' }, extra: { k: 2 }, error: err },
    ]);

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('m1', {
      level: 'warning',
      tags: { action: 'a1' },
      extra: { k: 1 },
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      level: 'warning',
      tags: { action: 'a2' },
      extra: { k: 2 },
    });
  });

  it('Sentry ล้มต้องไม่ทำให้งานที่ commit แล้วล้ม', () => {
    (Sentry.captureMessage as jest.Mock).mockImplementationOnce(() => {
      throw new Error('sentry down');
    });
    expect(() => emitDeferredWarnings([{ message: 'm', tags: {}, extra: {} }])).not.toThrow();
  });

  it('warningsOf: ผลที่ไม่มีฟิลด์ warnings (mock ที่คืน undefined) → รายการว่าง', () => {
    expect(warningsOf(undefined)).toEqual([]);
    expect(warningsOf(null)).toEqual([]);
    expect(warningsOf({})).toEqual([]);
    const w = [{ message: 'm', tags: {}, extra: {} }];
    expect(warningsOf({ warnings: w })).toBe(w);
  });
});
