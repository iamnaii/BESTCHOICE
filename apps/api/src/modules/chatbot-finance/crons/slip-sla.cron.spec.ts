import { Test, TestingModule } from '@nestjs/testing';
import { SlipSlaCron } from './slip-sla.cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { StaffNotificationService } from '../services/staff-notification.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('SlipSlaCron.scanOverdueEvidences', () => {
  let cron: SlipSlaCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let staffNotify: any;

  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();

    prisma = {
      paymentEvidence: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    staffNotify = {
      notifySlipSlaBreached: jest.fn().mockResolvedValue(undefined),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        SlipSlaCron,
        { provide: PrismaService, useValue: prisma },
        { provide: StaffNotificationService, useValue: staffNotify },
      ],
    }).compile();
    cron = mod.get(SlipSlaCron);
  });

  it('returns count=0 and does not alert when no stuck evidences', async () => {
    const result = await cron.scanOverdueEvidences();
    expect(result.count).toBe(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(staffNotify.notifySlipSlaBreached).not.toHaveBeenCalled();
  });

  it('queries PENDING_REVIEW evidences between 24h and 4h old', async () => {
    await cron.scanOverdueEvidences();
    const where = prisma.paymentEvidence.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PENDING_REVIEW');
    expect(where.deletedAt).toBeNull();
    expect(where.createdAt.lte).toBeInstanceOf(Date);
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it('alerts staff + Sentry when 2 evidences are stuck', async () => {
    prisma.paymentEvidence.findMany.mockResolvedValue([
      { id: 'ev-1', createdAt: hoursAgo(6) },
      { id: 'ev-2', createdAt: hoursAgo(5) },
    ]);

    const result = await cron.scanOverdueEvidences();

    expect(result.count).toBe(2);
    expect(result.oldestAgeHours).toBeGreaterThanOrEqual(5.9);
    expect(staffNotify.notifySlipSlaBreached).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 }),
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('Slip review SLA breached'),
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ cron: 'slip-sla' }),
      }),
    );
  });

  it('captures exception on DB failure (does NOT throw)', async () => {
    prisma.paymentEvidence.findMany.mockRejectedValue(new Error('db down'));

    const result = await cron.scanOverdueEvidences();

    expect(result.count).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ cron: 'slip-sla' }) }),
    );
  });
});
