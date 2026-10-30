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
      providers: [ReceivableReconService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(ReceivableReconService);
  });

  /** The service runs one $queryRaw (per-contract gaps — `loadContractReceivableGaps`). */
  const queueContracts = (
    rows: Array<{ id: string; branch: string | null; gl: string; register: string }>,
  ) => {
    prisma.$queryRaw.mockResolvedValueOnce(
      rows.map((r) => ({
        contract_id: r.id,
        contract_number: `BC-${r.id}`,
        branch_id: r.branch,
        gl_receivable: new Prisma.Decimal(r.gl),
        register_outstanding: new Prisma.Decimal(r.register),
      })),
    );
  };

  it('records 0 breaches when every contract of the branch reconciles', async () => {
    queueContracts([
      { id: '1', branch: 'b-1', gl: '12849.19', register: '12849.19' },
      { id: '2', branch: 'b-1', gl: '9093.00', register: '9092.00' }, // rounding ≤ 1.00
    ]);

    const result = await service.reconcileBranches();
    expect(result.rows).toBe(1);
    expect(result.breached).toHaveLength(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('flags the branch when a single contract is beyond 1.00 (a large branch no longer hides it)', async () => {
    queueContracts([
      { id: '1', branch: 'b-big', gl: '10000000.00', register: '10000000.00' },
      { id: '2', branch: 'b-big', gl: '1515.83', register: '1415.83' },
    ]);

    const result = await service.reconcileBranches();
    expect(result.breached).toEqual([{ branchId: 'b-big', gap: 100, contracts: 1 }]);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const extra = (Sentry.captureMessage as jest.Mock).mock.calls[0][1].extra;
    expect(extra.contracts).toEqual([
      { branchId: 'b-big', contractId: '2', contractNumber: 'BC-2', gap: '100.00' },
    ]);
  });

  it('flags offsetting contracts even when the branch total nets to zero', async () => {
    queueContracts([
      { id: '1', branch: 'b-1', gl: '1100.00', register: '1000.00' },
      { id: '2', branch: 'b-1', gl: '1000.00', register: '1100.00' },
    ]);
    const result = await service.reconcileBranches();
    expect(result.breached).toEqual([{ branchId: 'b-1', gap: 0, contracts: 2 }]);
  });

  it('skips contracts without a branch', async () => {
    queueContracts([{ id: '1', branch: null, gl: '500.00', register: '0.00' }]);
    const result = await service.reconcileBranches();
    expect(result.rows).toBe(0);
    expect(prisma.receivableReconLog.upsert).not.toHaveBeenCalled();
  });

  it('persists each branch row with the per-contract tolerance as threshold', async () => {
    queueContracts([
      { id: '1', branch: 'b-1', gl: '100000.00', register: '95000.00' },
      { id: '2', branch: 'b-2', gl: '300.00', register: '300.00' },
    ]);
    await service.reconcileBranches();
    expect(prisma.receivableReconLog.upsert).toHaveBeenCalledTimes(2);
    const created = prisma.receivableReconLog.upsert.mock.calls.map(
      (c: [{ create: Record<string, unknown> }]) => c[0].create,
    );
    const b1 = created.find((c: Record<string, unknown>) => c.branchId === 'b-1');
    expect(Number(b1.journalBalance)).toBe(100000);
    expect(Number(b1.contractOutstanding)).toBe(95000);
    expect(Number(b1.gap)).toBe(5000);
    expect(Number(b1.threshold)).toBe(1);
    expect(b1.breached).toBe(true);
    expect(created.find((c: Record<string, unknown>) => c.branchId === 'b-2').breached).toBe(false);
  });

  it('reads the receivable accounts, never the allowance 11-2102 or reference_type CONTRACT', async () => {
    queueContracts([]);
    await service.reconcileBranches();
    const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0]);
    expect(sql).toContain('11-2101');
    expect(sql).not.toContain('11-2102');
    expect(sql).not.toContain("'CONTRACT'");
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
      providers: [ReceivableReconService, { provide: PrismaService, useValue: prisma }],
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
