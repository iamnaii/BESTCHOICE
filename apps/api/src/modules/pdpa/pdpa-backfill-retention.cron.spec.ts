import { Test, TestingModule } from '@nestjs/testing';
import { PdpaBackfillRetentionCron } from './pdpa-backfill-retention.cron';
import { PdpaEncryptionService } from './pdpa-encryption.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('PdpaBackfillRetentionCron (W2)', () => {
  let cron: PdpaBackfillRetentionCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;

  beforeEach(async () => {
    service = { pruneOldRuns: jest.fn() };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PdpaBackfillRetentionCron,
        { provide: PdpaEncryptionService, useValue: service },
      ],
    }).compile();
    cron = mod.get(PdpaBackfillRetentionCron);
  });

  it('delegates to service.pruneOldRuns with 365-day window', async () => {
    service.pruneOldRuns.mockResolvedValue(7);
    const result = await cron.pruneOldRuns();
    expect(service.pruneOldRuns).toHaveBeenCalledWith(365);
    expect(result).toEqual({ pruned: 7 });
  });

  it('matches the documented retention constant (1 year)', () => {
    expect(PdpaBackfillRetentionCron.RETENTION_DAYS).toBe(365);
  });

  it('swallows errors so the scheduler never crashes (still returns)', async () => {
    service.pruneOldRuns.mockRejectedValue(new Error('db gone'));
    const result = await cron.pruneOldRuns();
    expect(result).toEqual({ pruned: 0 });
  });
});
