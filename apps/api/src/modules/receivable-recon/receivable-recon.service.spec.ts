import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ReceivableReconService } from './receivable-recon.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('ReceivableReconService.reconcileBranches', () => {
  let service: ReceivableReconService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    prisma = {
      $queryRaw: jest.fn(),
      receivableReconLog: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ReceivableReconService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(ReceivableReconService);
  });

  /**
   * The service runs 2 $queryRaw calls — journal first, payment second.
   * Mock them in order.
   */
  const queueQueries = (
    journalRows: Array<{ branch_id: string; balance: string | number }>,
    paymentRows: Array<{ branch_id: string; outstanding: string | number }>,
  ) => {
    prisma.$queryRaw
      .mockResolvedValueOnce(
        journalRows.map((r) => ({ ...r, balance: new Prisma.Decimal(r.balance) })),
      )
      .mockResolvedValueOnce(
        paymentRows.map((r) => ({ ...r, outstanding: new Prisma.Decimal(r.outstanding) })),
      );
  };

  it('records 0 breaches when journal matches payment per branch', async () => {
    queueQueries(
      [{ branch_id: 'b-1', balance: 100000 }],
      [{ branch_id: 'b-1', outstanding: 100000 }],
    );

    const result = await service.reconcileBranches();
    expect(result.rows).toBe(1);
    expect(result.breached).toHaveLength(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('flags breach when gap exceeds threshold (min ฿1000)', async () => {
    queueQueries(
      [{ branch_id: 'b-1', balance: 100000 }],
      [{ branch_id: 'b-1', outstanding: 98000 }], // gap = 2000 > max(100k*0.001=100, 1000)
    );

    const result = await service.reconcileBranches();
    expect(result.breached).toHaveLength(1);
    expect(result.breached[0].branchId).toBe('b-1');
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });

  it('does NOT flag tiny gap below ฿1000 minimum', async () => {
    queueQueries(
      [{ branch_id: 'b-1', balance: 100000 }],
      [{ branch_id: 'b-1', outstanding: 99500 }], // gap = 500 < 1000 minimum
    );

    const result = await service.reconcileBranches();
    expect(result.breached).toHaveLength(0);
  });

  it('applies 0.1% threshold for large branches', async () => {
    // outstanding 10M → threshold = max(10M * 0.001 = 10k, 1k) = 10k
    // gap 5000 < 10000 → no breach (min floor doesn't help when branch is huge)
    queueQueries(
      [{ branch_id: 'b-big', balance: 10_005_000 }],
      [{ branch_id: 'b-big', outstanding: 10_000_000 }],
    );
    const withinPct = await service.reconcileBranches();
    expect(withinPct.breached).toHaveLength(0);

    // gap 15000 > threshold 10000 → breach
    queueQueries(
      [{ branch_id: 'b-big', balance: 10_015_000 }],
      [{ branch_id: 'b-big', outstanding: 10_000_000 }],
    );
    const overPct = await service.reconcileBranches();
    expect(overPct.breached).toHaveLength(1);
  });

  it('handles branches present in one table but not the other', async () => {
    queueQueries(
      [{ branch_id: 'b-journal-only', balance: 5000 }],
      [{ branch_id: 'b-payment-only', outstanding: 7000 }],
    );

    const result = await service.reconcileBranches();
    // Both branches get a row written (gap = full amount each)
    expect(result.rows).toBe(2);
    expect(result.breached.length).toBe(2);
  });

  it('persists each branch row with correct fields', async () => {
    queueQueries(
      [{ branch_id: 'b-1', balance: 100000 }],
      [{ branch_id: 'b-1', outstanding: 95000 }],
    );
    await service.reconcileBranches();
    const upsertArgs = prisma.receivableReconLog.upsert.mock.calls[0][0];
    expect(upsertArgs.create.branchId).toBe('b-1');
    expect(Number(upsertArgs.create.gap)).toBe(5000);
    expect(upsertArgs.create.breached).toBe(true);
  });
});

describe('ReceivableReconService.purgeOldLogs', () => {
  let service: ReceivableReconService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      receivableReconLog: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
      $queryRaw: jest.fn(),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ReceivableReconService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(ReceivableReconService);
  });

  it('deletes rows older than 90 days', async () => {
    const result = await service.purgeOldLogs();
    expect(result.deleted).toBe(5);
    const where = prisma.receivableReconLog.deleteMany.mock.calls[0][0].where;
    const cutoff = where.createdAt.lt as Date;
    const ageDays = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(89.9);
    expect(ageDays).toBeLessThan(90.1);
  });
});
