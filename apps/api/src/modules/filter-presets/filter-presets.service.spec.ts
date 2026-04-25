import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FilterPresetScope } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FilterPresetsService } from './filter-presets.service';

const mockPrisma = {
  filterPreset: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

describe('FilterPresetsService', () => {
  let service: FilterPresetsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilterPresetsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(FilterPresetsService);
  });

  describe('create', () => {
    it('creates a PRIVATE preset for any user', async () => {
      mockPrisma.filterPreset.create.mockResolvedValueOnce({
        id: 'p1',
        ownerUserId: 'u1',
        scope: FilterPresetScope.PRIVATE,
      });

      const result = await service.create(
        {
          name: 'My filter',
          scope: FilterPresetScope.PRIVATE,
          page: 'collections-queue',
          filterJson: { assigned: 'self' },
        },
        'u1',
        'SALES',
        'br1',
      );

      expect(result.ownerUserId).toBe('u1');
      const arg = mockPrisma.filterPreset.create.mock.calls[0][0];
      expect(arg.data.scope).toBe(FilterPresetScope.PRIVATE);
      expect(arg.data.branchId).toBeUndefined();
      expect(arg.data.ownerUserId).toBe('u1');
    });

    it('rejects SHARED_ALL for non-OWNER', async () => {
      await expect(
        service.create(
          {
            name: 'Global',
            scope: FilterPresetScope.SHARED_ALL,
            page: 'collections-queue',
            filterJson: {},
          },
          'u1',
          'BRANCH_MANAGER',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.filterPreset.create).not.toHaveBeenCalled();
    });

    it('allows SHARED_ALL for OWNER (clears branchId)', async () => {
      mockPrisma.filterPreset.create.mockResolvedValueOnce({ id: 'p2' });
      await service.create(
        {
          name: 'Global',
          scope: FilterPresetScope.SHARED_ALL,
          page: 'collections-queue',
          filterJson: {},
          branchId: 'br1',
        },
        'owner1',
        'OWNER',
        'br1',
      );
      const arg = mockPrisma.filterPreset.create.mock.calls[0][0];
      expect(arg.data.branchId).toBeUndefined();
    });

    it('rejects SHARED_BRANCH for SALES', async () => {
      await expect(
        service.create(
          {
            name: 'Branch',
            scope: FilterPresetScope.SHARED_BRANCH,
            page: 'collections-queue',
            filterJson: {},
          },
          'u1',
          'SALES',
          'br1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows SHARED_BRANCH for FINANCE_MANAGER and falls back to user branch', async () => {
      mockPrisma.filterPreset.create.mockResolvedValueOnce({ id: 'p3' });
      await service.create(
        {
          name: 'Branch X',
          scope: FilterPresetScope.SHARED_BRANCH,
          page: 'collections-queue',
          filterJson: {},
        },
        'fm1',
        'FINANCE_MANAGER',
        'br99',
      );
      const arg = mockPrisma.filterPreset.create.mock.calls[0][0];
      expect(arg.data.branchId).toBe('br99');
    });
  });

  describe('list', () => {
    it('returns PRIVATE owned + SHARED_ALL + SHARED_BRANCH for branch user', async () => {
      mockPrisma.filterPreset.findMany.mockResolvedValueOnce([
        { id: 'a', scope: 'PRIVATE' },
        { id: 'b', scope: 'SHARED_BRANCH' },
        { id: 'c', scope: 'SHARED_ALL' },
      ]);

      const presets = await service.list({
        userId: 'u1',
        userRole: 'BRANCH_MANAGER',
        branchId: 'br1',
        page: 'collections-queue',
      });

      expect(presets).toHaveLength(3);
      const arg = mockPrisma.filterPreset.findMany.mock.calls[0][0];
      expect(arg.where.deletedAt).toBeNull();
      expect(arg.where.page).toBe('collections-queue');
      // visibility OR includes 3 conditions for branched user
      expect(arg.where.OR).toHaveLength(3);
    });

    it('OWNER sees all SHARED_BRANCH presets even when branchId null', async () => {
      mockPrisma.filterPreset.findMany.mockResolvedValueOnce([]);
      await service.list({
        userId: 'owner1',
        userRole: 'OWNER',
        branchId: null,
        page: 'collections-queue',
      });
      const arg = mockPrisma.filterPreset.findMany.mock.calls[0][0];
      const orConds = arg.where.OR as Array<{ scope: string }>;
      // Should include unconditional SHARED_BRANCH visibility
      expect(orConds.some((c) => c.scope === 'SHARED_BRANCH')).toBe(true);
    });
  });

  describe('delete', () => {
    it('throws NotFound when preset missing', async () => {
      mockPrisma.filterPreset.findFirst.mockResolvedValueOnce(null);
      await expect(service.delete('missing', 'u1', 'SALES')).rejects.toThrow(NotFoundException);
    });

    it('rejects when non-owner non-OWNER tries to delete', async () => {
      mockPrisma.filterPreset.findFirst.mockResolvedValueOnce({
        id: 'p1',
        ownerUserId: 'u2',
      });
      await expect(service.delete('p1', 'u1', 'SALES')).rejects.toThrow(ForbiddenException);
    });

    it('soft-deletes when owner', async () => {
      mockPrisma.filterPreset.findFirst.mockResolvedValueOnce({ id: 'p1', ownerUserId: 'u1' });
      mockPrisma.filterPreset.update.mockResolvedValueOnce({ id: 'p1', deletedAt: new Date() });
      await service.delete('p1', 'u1', 'SALES');
      const arg = mockPrisma.filterPreset.update.mock.calls[0][0];
      expect(arg.where.id).toBe('p1');
      expect(arg.data.deletedAt).toBeInstanceOf(Date);
    });

    it('OWNER can delete any preset', async () => {
      mockPrisma.filterPreset.findFirst.mockResolvedValueOnce({ id: 'p1', ownerUserId: 'someone' });
      mockPrisma.filterPreset.update.mockResolvedValueOnce({ id: 'p1' });
      await service.delete('p1', 'owner1', 'OWNER');
      expect(mockPrisma.filterPreset.update).toHaveBeenCalled();
    });
  });
});
