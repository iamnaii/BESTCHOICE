import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ContractSnapshotCron } from './contract-snapshot.cron';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('ContractSnapshotCron.runDaily', () => {
  let cron: ContractSnapshotCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();

    prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      contractDailySnapshot: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ContractSnapshotCron,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    cron = mod.get(ContractSnapshotCron);
  });

  it('creates one snapshot per active overdue contract (skips zero-daysOverdue rows)', async () => {
    // 3 candidate contracts: 2 with past-due payment (overdue >0), 1 with
    // dueDate today (daysOverdue == 0 → filtered out before insert)
    const yesterday = new Date(Date.now() - 86400000);
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    const today = new Date();

    prisma.contract.findMany.mockResolvedValue([
      {
        id: 'c-1',
        status: 'OVERDUE',
        payments: [
          {
            dueDate: yesterday,
            amountDue: new Prisma.Decimal('1000.00'),
            amountPaid: new Prisma.Decimal('0'),
            lateFee: new Prisma.Decimal('50.00'),
          },
        ],
      },
      {
        id: 'c-2',
        status: 'DEFAULT',
        payments: [
          {
            dueDate: tenDaysAgo,
            amountDue: new Prisma.Decimal('2000.00'),
            amountPaid: new Prisma.Decimal('500.00'),
            lateFee: new Prisma.Decimal('0'),
          },
        ],
      },
      {
        id: 'c-3',
        status: 'OVERDUE',
        payments: [
          {
            dueDate: today,
            amountDue: new Prisma.Decimal('500.00'),
            amountPaid: new Prisma.Decimal('0'),
            lateFee: new Prisma.Decimal('0'),
          },
        ],
      },
    ]);
    prisma.contractDailySnapshot.createMany.mockResolvedValue({ count: 2 });

    const result = await cron.runDaily();

    expect(result.snapshotted).toBe(2);
    const createArgs = prisma.contractDailySnapshot.createMany.mock.calls[0][0];
    expect(createArgs.skipDuplicates).toBe(true);
    expect(createArgs.data).toHaveLength(2);
    expect(createArgs.data.map((r: { contractId: string }) => r.contractId).sort()).toEqual([
      'c-1',
      'c-2',
    ]);

    // Verify queue.service-style outstanding derivation for c-2:
    // (amountDue 2000 - amountPaid 500 + lateFee 0) = 1500
    const c2Row = createArgs.data.find((r: { contractId: string }) => r.contractId === 'c-2');
    expect(new Prisma.Decimal(c2Row.outstanding).toString()).toBe('1500');
    expect(c2Row.daysOverdue).toBeGreaterThanOrEqual(10);
    expect(c2Row.status).toBe('DEFAULT');
  });

  it('does not duplicate snapshot for same date (relies on skipDuplicates + unique constraint)', async () => {
    const yesterday = new Date(Date.now() - 86400000);
    const candidate = {
      id: 'c-1',
      status: 'OVERDUE' as const,
      payments: [
        {
          dueDate: yesterday,
          amountDue: new Prisma.Decimal('1000.00'),
          amountPaid: new Prisma.Decimal('0'),
          lateFee: new Prisma.Decimal('0'),
        },
      ],
    };
    prisma.contract.findMany.mockResolvedValue([candidate]);

    // First run: 1 inserted
    prisma.contractDailySnapshot.createMany.mockResolvedValueOnce({ count: 1 });
    const r1 = await cron.runDaily();
    expect(r1.snapshotted).toBe(1);

    // Second run same day: createMany returns count=0 because the unique
    // (contractId, date) index dedups via skipDuplicates
    prisma.contractDailySnapshot.createMany.mockResolvedValueOnce({ count: 0 });
    const r2 = await cron.runDaily();
    expect(r2.snapshotted).toBe(0);

    // skipDuplicates was passed both times — that's the contract this test enforces
    const calls = prisma.contractDailySnapshot.createMany.mock.calls;
    expect(calls.every((c: [{ skipDuplicates: boolean }]) => c[0].skipDuplicates === true)).toBe(true);
  });

  it('prunes snapshots older than 30 days', async () => {
    prisma.contractDailySnapshot.deleteMany.mockResolvedValue({ count: 5 });

    const result = await cron.runDaily();

    expect(result.pruned).toBe(5);
    const deleteArgs = prisma.contractDailySnapshot.deleteMany.mock.calls[0][0];
    expect(deleteArgs.where.date.lt).toBeInstanceOf(Date);
    // Cutoff should be ~30 days before today (allow ±1 day for boundary)
    const cutoff = deleteArgs.where.date.lt as Date;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - cutoff.getTime()) / 86400000);
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });
});
