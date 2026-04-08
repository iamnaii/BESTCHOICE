import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InterestConfigService } from './interest-config.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('InterestConfigService', () => {
  let service: InterestConfigService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      interestConfig: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InterestConfigService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InterestConfigService>(InterestConfigService);
  });

  describe('findAll', () => {
    it('filters out soft-deleted configs', async () => {
      prisma.interestConfig.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.interestConfig.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns a config when found and not soft-deleted', async () => {
      const row = { id: 'cfg-1', name: 'มือ 1' };
      prisma.interestConfig.findFirst.mockResolvedValue(row);

      await expect(service.findOne('cfg-1')).resolves.toBe(row);
      expect(prisma.interestConfig.findFirst).toHaveBeenCalledWith({
        where: { id: 'cfg-1', deletedAt: null },
      });
    });

    it('throws NotFoundException when soft-deleted or missing', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(null);

      await expect(service.findOne('cfg-missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByCategory', () => {
    it('only returns active, non-deleted configs matching the category', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(null);

      await service.findByCategory('PHONE');

      expect(prisma.interestConfig.findFirst).toHaveBeenCalledWith({
        where: {
          isActive: true,
          deletedAt: null,
          productCategories: { has: 'PHONE' },
        },
      });
    });
  });

  describe('remove', () => {
    it('performs a real soft delete (sets deletedAt) and flips isActive', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue({ id: 'cfg-1' });
      prisma.interestConfig.update.mockResolvedValue({ id: 'cfg-1', deletedAt: new Date() });

      await service.remove('cfg-1');

      const updateCall = prisma.interestConfig.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'cfg-1' });
      expect(updateCall.data.isActive).toBe(false);
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    });

    it('throws NotFound when the config does not exist', async () => {
      prisma.interestConfig.findFirst.mockResolvedValue(null);

      await expect(service.remove('cfg-missing')).rejects.toThrow(NotFoundException);
      expect(prisma.interestConfig.update).not.toHaveBeenCalled();
    });
  });
});
