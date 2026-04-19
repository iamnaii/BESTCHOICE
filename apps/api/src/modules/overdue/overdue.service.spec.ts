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
