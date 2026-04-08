import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CompanyService } from './company.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CompanyService', () => {
  let service: CompanyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      companyInfo: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      branch: {
        count: jest.fn().mockResolvedValue(0),
      },
      product: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  describe('create', () => {
    const baseDto = {
      nameTh: 'BEST CHOICE SHOP',
      taxId: '0105561234567',
      address: 'Bangkok',
      directorName: 'สมชาย ใจดี',
    };

    it('creates a company when companyCode is unused', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue(null);
      prisma.companyInfo.create.mockResolvedValue({ id: 'c-1', ...baseDto });

      await service.create({ ...baseDto, companyCode: 'SHOP' });

      expect(prisma.companyInfo.findFirst).toHaveBeenCalledWith({
        where: { companyCode: 'SHOP', deletedAt: null },
      });
      expect(prisma.companyInfo.create).toHaveBeenCalled();
    });

    it('rejects duplicate companyCode with ConflictException', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ ...baseDto, companyCode: 'FINANCE' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.companyInfo.create).not.toHaveBeenCalled();
    });

    it('skips the uniqueness check when companyCode is omitted', async () => {
      prisma.companyInfo.create.mockResolvedValue({ id: 'c-2' });

      await service.create(baseDto);

      expect(prisma.companyInfo.findFirst).not.toHaveBeenCalled();
      expect(prisma.companyInfo.create).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const existing = { id: 'c-1', nameTh: 'SHOP', companyCode: 'SHOP' };

    beforeEach(() => {
      prisma.companyInfo.findFirst.mockResolvedValue(existing);
    });

    it('soft-deletes when company has no branches or owned products', async () => {
      prisma.branch.count.mockResolvedValue(0);
      prisma.product.count.mockResolvedValue(0);
      prisma.companyInfo.update.mockResolvedValue({ ...existing, deletedAt: new Date() });

      await service.remove('c-1');

      const updateArgs = prisma.companyInfo.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'c-1' });
      expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
      expect(updateArgs.data.isActive).toBe(false);
    });

    it('refuses to delete when branches still reference the company', async () => {
      prisma.branch.count.mockResolvedValue(3);
      prisma.product.count.mockResolvedValue(0);

      await expect(service.remove('c-1')).rejects.toThrow(BadRequestException);
      expect(prisma.companyInfo.update).not.toHaveBeenCalled();
    });

    it('refuses to delete when products still carry ownership', async () => {
      prisma.branch.count.mockResolvedValue(0);
      prisma.product.count.mockResolvedValue(5);

      await expect(service.remove('c-1')).rejects.toThrow(BadRequestException);
      expect(prisma.companyInfo.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the company does not exist', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
