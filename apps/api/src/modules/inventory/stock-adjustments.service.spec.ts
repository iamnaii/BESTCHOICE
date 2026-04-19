import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * T5-C3 — 4-eyes on every stock adjustment. The adjuster (userId) and the
 * approver (dto.approverId) must be different people, and the approver must
 * be manager-tier (OWNER / FINANCE_MANAGER / BRANCH_MANAGER). Historical
 * rule that BRANCH_MANAGER could self-approve is removed.
 */
describe('StockAdjustmentsService.create — T5-C3 4-eyes', () => {
  let service: StockAdjustmentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const baseDto = {
    productId: 'p1',
    reason: 'CORRECTION' as const,
    approverId: 'approver-bm',
    notes: 'audit correction',
  };

  beforeEach(async () => {
    prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          status: 'IN_STOCK',
          branchId: 'branch-1',
          deletedAt: null,
        }),
        update: jest.fn(),
      },
      stockAdjustment: {
        create: jest.fn().mockResolvedValue({ id: 'adj-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where: { id } }) =>
          Promise.resolve({
            id,
            role: id.startsWith('approver-bm') ? 'BRANCH_MANAGER'
              : id.startsWith('approver-fm') ? 'FINANCE_MANAGER'
              : id.startsWith('approver-owner') ? 'OWNER'
              : id.startsWith('approver-sales') ? 'SALES'
              : 'SALES',
            isActive: true,
            deletedAt: null,
          }),
        ),
      },
      $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [StockAdjustmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(StockAdjustmentsService);
  });

  it('rejects when approverId is missing', async () => {
    const dto = { ...baseDto, approverId: '' };
    await expect(service.create(dto, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects self-approval (adjuster === approver)', async () => {
    await expect(
      service.create({ ...baseDto, approverId: 'user-1' }, 'user-1'),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.stockAdjustment.create).not.toHaveBeenCalled();
  });

  it('rejects when approver does not exist', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.create({ ...baseDto, approverId: 'ghost' }, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when approver is deactivated', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'approver-bm',
      role: 'BRANCH_MANAGER',
      isActive: false,
      deletedAt: null,
    });
    await expect(service.create(baseDto, 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects when approver is not manager-tier (e.g. SALES)', async () => {
    await expect(
      service.create({ ...baseDto, approverId: 'approver-sales' }, 'user-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('accepts BRANCH_MANAGER approver for a non-self adjustment', async () => {
    await expect(service.create(baseDto, 'user-1')).resolves.toBeDefined();
    expect(prisma.stockAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adjustedById: 'user-1',
          approvedById: 'approver-bm',
          approvedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('accepts OWNER approver', async () => {
    await expect(
      service.create({ ...baseDto, approverId: 'approver-owner' }, 'user-1'),
    ).resolves.toBeDefined();
  });
});
