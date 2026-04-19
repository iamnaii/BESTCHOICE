import { Test, TestingModule } from '@nestjs/testing';
import { PeakSyncCron } from './peak-sync.cron';
import { PeakService } from './peak.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('PeakSyncCron.dailySync', () => {
  let cron: PeakSyncCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let peak: any;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
    peak = {
      isConfigured: jest.fn().mockResolvedValue(true),
      exportJournalEntries: jest.fn().mockResolvedValue({ exported: 0, errors: [] }),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [PeakSyncCron, { provide: PeakService, useValue: peak }],
    }).compile();
    cron = mod.get(PeakSyncCron);
  });

  it('skips silently when PEAK is not configured', async () => {
    peak.isConfigured.mockResolvedValue(false);
    const result = await cron.dailySync();
    expect(result).toEqual({ exported: 0, errors: 0 });
    expect(peak.exportJournalEntries).not.toHaveBeenCalled();
  });

  it('exports yesterday-to-now window', async () => {
    await cron.dailySync();
    const [start, end] = peak.exportJournalEntries.mock.calls[0];
    const dayDiff = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(dayDiff).toBeGreaterThan(0.9);
    expect(dayDiff).toBeLessThan(2);
  });

  it('reports exported count when success', async () => {
    peak.exportJournalEntries.mockResolvedValue({ exported: 7, errors: [] });
    const result = await cron.dailySync();
    expect(result.exported).toBe(7);
    expect(result.errors).toBe(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('Sentry warning when errors present', async () => {
    peak.exportJournalEntries.mockResolvedValue({
      exported: 5,
      errors: ['JE-001: timeout', 'JE-002: resCode=500'],
    });
    const result = await cron.dailySync();
    expect(result.errors).toBe(2);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('2 errors'),
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('swallows exception + Sentry capture (no throw)', async () => {
    peak.exportJournalEntries.mockRejectedValue(new Error('peak down'));
    const result = await cron.dailySync();
    expect(result).toEqual({ exported: 0, errors: 0 });
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
