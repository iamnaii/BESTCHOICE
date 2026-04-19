import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadStage } from '@prisma/client';
import { CrmPipelineService } from './crm-pipeline.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('CrmPipelineService.assignLead (T5-C7 history)', () => {
  let service: CrmPipelineService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      crmLead: {
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', assignedToId: 'u-old' }),
        update: jest.fn((args) => Promise.resolve({ id: 'lead-1', ...args.data })),
      },
      crmLeadAssignment: {
        create: jest.fn().mockResolvedValue({ id: 'ass-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [CrmPipelineService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(CrmPipelineService);
  });

  it('writes history row with from/to/changedBy + reason', async () => {
    await service.assignLead('lead-1', 'u-new', 'u-manager', 'reassign to branch specialist');
    const assignArgs = prisma.crmLeadAssignment.create.mock.calls[0][0];
    expect(assignArgs.data.leadId).toBe('lead-1');
    expect(assignArgs.data.fromUserId).toBe('u-old');
    expect(assignArgs.data.toUserId).toBe('u-new');
    expect(assignArgs.data.changedById).toBe('u-manager');
    expect(assignArgs.data.reason).toBe('reassign to branch specialist');
  });

  it('fromUserId null when first assignment', async () => {
    prisma.crmLead.findUnique.mockResolvedValue({ id: 'lead-1', assignedToId: null });
    await service.assignLead('lead-1', 'u-new', 'u-manager');
    const assignArgs = prisma.crmLeadAssignment.create.mock.calls[0][0];
    expect(assignArgs.data.fromUserId).toBeNull();
  });

  it('skips no-op (same owner) — no history row', async () => {
    prisma.crmLead.findUnique.mockResolvedValue({ id: 'lead-1', assignedToId: 'u-same' });
    await service.assignLead('lead-1', 'u-same', 'u-manager');
    expect(prisma.crmLeadAssignment.create).not.toHaveBeenCalled();
  });

  it('throws when lead not found', async () => {
    prisma.crmLead.findUnique.mockResolvedValue(null);
    await expect(
      service.assignLead('missing', 'u-new', 'u-manager'),
    ).rejects.toThrow();
  });

  it('trims empty reason to null', async () => {
    await service.assignLead('lead-1', 'u-new', 'u-manager', '   ');
    const assignArgs = prisma.crmLeadAssignment.create.mock.calls[0][0];
    expect(assignArgs.data.reason).toBeNull();
  });

  it('getAssignmentHistory returns ordered history with user details', async () => {
    await service.getAssignmentHistory('lead-1');
    const args = prisma.crmLeadAssignment.findMany.mock.calls[0][0];
    expect(args.where.leadId).toBe('lead-1');
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.include.fromUser).toBeDefined();
    expect(args.include.toUser).toBeDefined();
    expect(args.include.changedBy).toBeDefined();
  });
});

describe('CrmPipelineService.moveStage (T5-C15 stage history)', () => {
  let service: CrmPipelineService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      crmLead: {
        findUnique: jest.fn(),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      crmLeadStageHistory: {
        create: jest.fn().mockResolvedValue({ id: 'hist-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [CrmPipelineService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(CrmPipelineService);
  });

  it('writes an immutable stage history row on every real transition', async () => {
    prisma.crmLead.findUnique.mockResolvedValue({
      id: 'lead-1',
      stage: LeadStage.NEW_LEAD,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await service.moveStage('lead-1', LeadStage.QUALIFIED, 'u-sales');
    const arg = prisma.crmLeadStageHistory.create.mock.calls[0][0];
    expect(arg.data.leadId).toBe('lead-1');
    expect(arg.data.oldStage).toBe(LeadStage.NEW_LEAD);
    expect(arg.data.newStage).toBe(LeadStage.QUALIFIED);
    expect(arg.data.stagedById).toBe('u-sales');
  });

  it('rejects backdated WON (wonAt would precede lead.createdAt)', async () => {
    // createdAt is in the future → now() is "before" createdAt
    prisma.crmLead.findUnique.mockResolvedValue({
      id: 'lead-1',
      stage: LeadStage.QUALIFIED,
      createdAt: new Date(Date.now() + 10_000_000),
    });
    await expect(
      service.moveStage('lead-1', LeadStage.WON, 'u-sales'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.crmLeadStageHistory.create).not.toHaveBeenCalled();
    expect(prisma.crmLead.update).not.toHaveBeenCalled();
  });

  it('logs sequential stages in order via multiple moveStage calls', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    // First transition: NEW_LEAD → QUALIFIED
    prisma.crmLead.findUnique.mockResolvedValueOnce({
      id: 'lead-1',
      stage: LeadStage.NEW_LEAD,
      createdAt,
    });
    await service.moveStage('lead-1', LeadStage.QUALIFIED, 'u-sales');

    // Second transition: QUALIFIED → PROPOSAL
    prisma.crmLead.findUnique.mockResolvedValueOnce({
      id: 'lead-1',
      stage: LeadStage.QUALIFIED,
      createdAt,
    });
    await service.moveStage('lead-1', LeadStage.PROPOSAL, 'u-sales');

    // Third transition: PROPOSAL → WON
    prisma.crmLead.findUnique.mockResolvedValueOnce({
      id: 'lead-1',
      stage: LeadStage.PROPOSAL,
      createdAt,
    });
    await service.moveStage('lead-1', LeadStage.WON, 'u-manager');

    expect(prisma.crmLeadStageHistory.create).toHaveBeenCalledTimes(3);
    const calls = prisma.crmLeadStageHistory.create.mock.calls;
    expect(calls[0][0].data.newStage).toBe(LeadStage.QUALIFIED);
    expect(calls[1][0].data.newStage).toBe(LeadStage.PROPOSAL);
    expect(calls[2][0].data.newStage).toBe(LeadStage.WON);
    // Old stage must chain correctly — oldStage[n] === newStage[n-1]
    expect(calls[1][0].data.oldStage).toBe(LeadStage.QUALIFIED);
    expect(calls[2][0].data.oldStage).toBe(LeadStage.PROPOSAL);
  });

  it('no-op when stage unchanged — no history row written', async () => {
    prisma.crmLead.findUnique.mockResolvedValue({
      id: 'lead-1',
      stage: LeadStage.PROPOSAL,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await service.moveStage('lead-1', LeadStage.PROPOSAL, 'u-sales');
    expect(prisma.crmLeadStageHistory.create).not.toHaveBeenCalled();
    expect(prisma.crmLead.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when lead missing', async () => {
    prisma.crmLead.findUnique.mockResolvedValue(null);
    await expect(
      service.moveStage('missing', LeadStage.QUALIFIED, 'u-sales'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
