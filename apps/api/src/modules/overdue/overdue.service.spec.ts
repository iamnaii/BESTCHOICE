import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OverdueService } from './overdue.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('OverdueService.recordSettlement', () => {
  let service: OverdueService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const futureDate = (days: number) =>
    new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  beforeEach(async () => {
    prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }),
      },
      callLog: {
        create: jest.fn((args) => Promise.resolve({ id: 'cl-1', ...args.data })),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(OverdueService);
  });

  it('creates a PROMISED CallLog when settlementDate is a future date within 30 days', async () => {
    const result = await service.recordSettlement('c-1', 'u-1', {
      settlementDate: futureDate(5),
      settlementNotes: 'ลูกค้าจะจ่ายสัปดาห์หน้า',
    });
    expect(result).toBeDefined();
    expect(prisma.callLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contractId: 'c-1',
          result: 'PROMISED',
        }),
      }),
    );
  });

  it('throws NotFound when contract missing', async () => {
    prisma.contract.findFirst.mockResolvedValue(null);
    await expect(
      service.recordSettlement('c-missing', 'u-1', {
        settlementDate: futureDate(5),
        settlementNotes: 'x',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects settlementDate in the past', async () => {
    await expect(
      service.recordSettlement('c-1', 'u-1', {
        settlementDate: futureDate(-1),
        settlementNotes: 'x',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects settlementDate more than 30 days out', async () => {
    await expect(
      service.recordSettlement('c-1', 'u-1', {
        settlementDate: futureDate(31),
        settlementNotes: 'x',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects malformed settlementDate string', async () => {
    await expect(
      service.recordSettlement('c-1', 'u-1', {
        settlementDate: 'not-a-date',
        settlementNotes: 'x',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('OverdueService.approveDunningEscalation (T4-C2)', () => {
  let service: OverdueService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const contractWithPending = (pending: string | null) => ({
    id: 'c-1',
    contractNumber: 'BC-001',
    dunningStage: 'NOTICE',
    pendingDunningStage: pending,
  });

  beforeEach(async () => {
    prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue(contractWithPending('FINAL_WARNING')),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const mod = await Test.createTestingModule({
      providers: [OverdueService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(OverdueService);
  });

  it('rejects non-OWNER/FM roles', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    await expect(
      service.approveDunningEscalation('c-1', 'u-1', 'BRANCH_MANAGER'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when no pending escalation', async () => {
    prisma.contract.findFirst.mockResolvedValue(contractWithPending(null));
    await expect(
      service.approveDunningEscalation('c-1', 'u-owner', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('flips dunningStage to pending target + clears pending + writes audit', async () => {
    await service.approveDunningEscalation('c-1', 'u-fm', 'FINANCE_MANAGER');
    const updateArgs = prisma.contract.update.mock.calls[0][0];
    expect(updateArgs.data.dunningStage).toBe('FINAL_WARNING');
    expect(updateArgs.data.pendingDunningStage).toBeNull();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DUNNING_ESCALATION_APPROVED' }),
      }),
    );
  });

  it('rejectDunningEscalation requires reason ≥ 5 chars', async () => {
    await expect(
      service.rejectDunningEscalation('c-1', 'u-owner', 'OWNER', 'no'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejectDunningEscalation clears pending + audit log', async () => {
    await service.rejectDunningEscalation(
      'c-1',
      'u-owner',
      'OWNER',
      'customer disputing — pause',
    );
    const updateArgs = prisma.contract.update.mock.calls[0][0];
    expect(updateArgs.data.pendingDunningStage).toBeNull();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DUNNING_ESCALATION_REJECTED' }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// T3-C11: manual hold on auto-escalation cron
// ─────────────────────────────────────────────────────────────
describe('OverdueService.updateContractStatuses (T3-C11 hold guard)', () => {
  let service: OverdueService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const setupService = async () => {
    const mod = await Test.createTestingModule({
      providers: [OverdueService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(OverdueService);
  };

  beforeEach(async () => {
    prisma = {
      contract: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      callLog: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'owner-1' }) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: '7' }) },
      payment: { aggregate: jest.fn() },
      auditLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    await setupService();
  });

  it('escalates contracts with no hold and no recent PROMISED', async () => {
    prisma.contract.findMany.mockResolvedValueOnce([
      { id: 'c-1', blockAutoEscalation: null },
    ]);
    prisma.callLog.findMany.mockResolvedValue([]);

    const result = await service.updateContractStatuses();
    expect(result.overdueUpdated).toBe(1);
    expect(prisma.contract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'OVERDUE' } }),
    );
  });

  it('skips contracts with active blockAutoEscalation', async () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
    prisma.contract.findMany.mockResolvedValueOnce([
      { id: 'c-1', blockAutoEscalation: future },
    ]);
    prisma.callLog.findMany.mockResolvedValue([]);

    const result = await service.updateContractStatuses();
    expect(result.overdueUpdated).toBe(0);
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('re-escalates after the hold expires', async () => {
    const past = new Date(Date.now() - 60 * 1000);
    prisma.contract.findMany.mockResolvedValueOnce([
      { id: 'c-1', blockAutoEscalation: past },
    ]);
    prisma.callLog.findMany.mockResolvedValue([]);

    const result = await service.updateContractStatuses();
    expect(result.overdueUpdated).toBe(1);
  });

  it('skips contracts with a PROMISED call log in last 24h', async () => {
    prisma.contract.findMany.mockResolvedValueOnce([
      { id: 'c-1', blockAutoEscalation: null },
    ]);
    prisma.callLog.findMany.mockResolvedValue([{ contractId: 'c-1' }]);

    const result = await service.updateContractStatuses();
    expect(result.overdueUpdated).toBe(0);
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });
});

describe('OverdueService.holdAutoEscalation (T3-C11)', () => {
  let service: OverdueService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'c-1',
          contractNumber: 'BC-001',
          blockAutoEscalation: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'c-1' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const mod = await Test.createTestingModule({
      providers: [OverdueService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(OverdueService);
  });

  it('sets blockAutoEscalation to now+48h by default for BM', async () => {
    const before = Date.now();
    const result = await service.holdAutoEscalation('c-1', 'u-1', 'BRANCH_MANAGER');
    const until = (result as { holdUntil: Date }).holdUntil.getTime();
    expect(until - before).toBeGreaterThan(47 * 60 * 60 * 1000);
    expect(until - before).toBeLessThan(49 * 60 * 60 * 1000);
  });

  it('rejects SALES role (insufficient privilege)', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    await expect(
      service.holdAutoEscalation('c-1', 'u-1', 'SALES'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects hoursFromNow > 168 (1 week max)', async () => {
    await expect(
      service.holdAutoEscalation('c-1', 'u-1', 'OWNER', 200),
    ).rejects.toThrow(BadRequestException);
  });
});

// ─────────────────────────────────────────────────────────────
// C2: audit must not silently skip when no SYSTEM user
// ─────────────────────────────────────────────────────────────
describe('OverdueService (C2: throw if no SYSTEM user)', () => {
  let service: OverdueService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      callLog: { findMany: jest.fn().mockResolvedValue([]) },
      // SYSTEM user does not exist
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: '7' }) },
      auditLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const mod = await Test.createTestingModule({
      providers: [OverdueService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(OverdueService);
  });

  it('throws if no SYSTEM user exists during updateContractStatuses', async () => {
    await expect(service.updateContractStatuses()).rejects.toThrow(/SYSTEM user/);
  });

  it('throws if no SYSTEM user exists during escalateDunningStages', async () => {
    // escalateDunningStages fetches contracts first then calls getSystemUserIdOrThrow
    // We need contract.findMany to return an entry so the loop iterates and hits the throw
    prisma.contract.findMany.mockResolvedValue([]);
    await expect(service.escalateDunningStages()).rejects.toThrow(/SYSTEM user/);
  });
});
