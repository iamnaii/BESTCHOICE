import { Test, TestingModule } from '@nestjs/testing';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { WarrantyCron } from './warranty.cron';
import { WarrantyService } from './warranty.service';
import { WarrantyLineNotifierService } from './warranty-line-notifier.service';
import type { ExpiringWarrantyItem } from './warranty.service';

function item(over: Partial<ExpiringWarrantyItem> = {}): ExpiringWarrantyItem {
  return {
    type: 'shop',
    source: 'SALE',
    sourceId: 's1',
    productName: 'x',
    deviceName: 'x',
    customerName: 'x',
    customerId: 'c1',
    expireDate: new Date('2026-09-28T00:00:00.000Z'),
    daysRemaining: 3,
    lineIdShop: 'U-1',
    ...over,
  };
}

describe('WarrantyCron', () => {
  let cron: WarrantyCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let warrantyService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifier: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    warrantyService = { getExpiringWarranties: jest.fn().mockResolvedValue([]) };
    notifier = { notifyExpiring: jest.fn() };

    // ไม่ provide PrismaService เลย — ถ้า constructor ยังต้องการมัน การ compile() นี้จะ throw
    // (Nest หา dependency ไม่เจอ) ทุกเทสต์ในไฟล์นี้จึงล้มทั้งหมด: พิสูจน์ว่าถอด PrismaService
    // ออกจาก constructor แล้วจริง (test brief (c))
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        WarrantyCron,
        { provide: WarrantyService, useValue: warrantyService },
        { provide: WarrantyLineNotifierService, useValue: notifier },
      ],
    }).compile();
    cron = mod.get(WarrantyCron);
  });

  afterEach(() => jest.restoreAllMocks());

  it('constructor เหลือ 2 dependency (warrantyService, notifier) — ไม่มี PrismaService ที่ไม่ได้ใช้', () => {
    expect(WarrantyCron.length).toBe(2);
  });

  it('registers the daily 09:00 Bangkok schedule', () => {
    expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, cron.checkExpiringWarranties)).toMatchObject({
      cronTime: '0 9 * * *',
      timeZone: 'Asia/Bangkok',
    });
  });

  it('เรียก getExpiringWarranties(7) แล้วเรียก notifier ต่อ item ทุกตัว นับผลครบ 5 ประเภท', async () => {
    warrantyService.getExpiringWarranties.mockResolvedValue([
      item({ sourceId: 's1' }),
      item({ sourceId: 's2' }),
      item({ sourceId: 's3' }),
      item({ sourceId: 's4' }),
      item({ sourceId: 's5' }),
    ]);
    notifier.notifyExpiring
      .mockResolvedValueOnce('SENT')
      .mockResolvedValueOnce('NO_LINK')
      .mockResolvedValueOnce('DUP')
      .mockResolvedValueOnce('BLOCKED')
      .mockResolvedValueOnce('FAILED');

    await cron.checkExpiringWarranties();

    expect(warrantyService.getExpiringWarranties).toHaveBeenCalledWith(7);
    expect(notifier.notifyExpiring).toHaveBeenCalledTimes(5);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('item ที่ notifier throw ไม่หยุด loop — นับเป็น FAILED + Sentry step:notify แล้วไปต่อ item ถัดไป', async () => {
    const boom = new Error('notify boom');
    warrantyService.getExpiringWarranties.mockResolvedValue([
      item({ sourceId: 's1' }),
      item({ sourceId: 's2' }),
    ]);
    notifier.notifyExpiring
      .mockImplementationOnce(async () => {
        throw boom;
      })
      .mockResolvedValueOnce('SENT');

    await cron.checkExpiringWarranties();

    expect(notifier.notifyExpiring).toHaveBeenCalledTimes(2);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, {
      tags: { kind: 'cron-job', cron: 'warranty-check', step: 'notify' },
    });
  });

  it('getExpiringWarranties throw → จับที่ชั้นนอก + Sentry คนละ tag ไม่ throw ออกไป', async () => {
    const boom = new Error('query boom');
    warrantyService.getExpiringWarranties.mockRejectedValue(boom);

    await expect(cron.checkExpiringWarranties()).resolves.toBeUndefined();

    expect(notifier.notifyExpiring).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, {
      tags: { kind: 'cron-job', cron: 'warranty-check' },
    });
  });
});
