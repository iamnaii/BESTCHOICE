import { Test, TestingModule } from '@nestjs/testing';
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
