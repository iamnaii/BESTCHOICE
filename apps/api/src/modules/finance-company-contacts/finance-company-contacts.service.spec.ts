import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FinanceCompanyContactsService } from './finance-company-contacts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FinanceCompanyContactsService', () => {
  let service: FinanceCompanyContactsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      financeCompanyContact: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      externalFinanceCompany: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
      $queryRaw: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceCompanyContactsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(FinanceCompanyContactsService);
  });

  describe('list', () => {
    it('returns contacts sorted with primary first then by name', async () => {
      await service.list('co-1');
      const call = prisma.financeCompanyContact.findMany.mock.calls[0][0];
      expect(call.where.externalFinanceCompanyId).toBe('co-1');
      expect(call.where.deletedAt).toBeNull();
      expect(call.orderBy).toEqual([{ isPrimary: 'desc' }, { isActive: 'desc' }, { name: 'asc' }]);
    });
  });

  describe('create', () => {
    it('rejects when company not found', async () => {
      prisma.externalFinanceCompany.findFirst.mockResolvedValue(null);
      await expect(
        service.create('co-1', { name: 'John' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates contact when company exists', async () => {
      prisma.externalFinanceCompany.findFirst.mockResolvedValue({ id: 'co-1' });
      prisma.financeCompanyContact.create.mockResolvedValue({ id: 'c-1' });
      await service.create('co-1', { name: 'John' });
      expect(prisma.financeCompanyContact.create).toHaveBeenCalled();
    });
  });

  describe('setPrimary', () => {
    it('clears other primaries before promoting', async () => {
      prisma.financeCompanyContact.findFirst.mockResolvedValue({
        id: 'c-2', externalFinanceCompanyId: 'co-1', deletedAt: null,
      });

      await service.setPrimary('co-1', 'c-2');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalled(); // FOR UPDATE lock
      expect(prisma.financeCompanyContact.updateMany).toHaveBeenCalledWith({
        where: { externalFinanceCompanyId: 'co-1', isPrimary: true, deletedAt: null },
        data: { isPrimary: false },
      });
      expect(prisma.financeCompanyContact.update).toHaveBeenCalledWith({
        where: { id: 'c-2' },
        data: { isPrimary: true },
      });
    });

    it('throws NotFound when contact does not belong to company', async () => {
      prisma.financeCompanyContact.findFirst.mockResolvedValue(null);
      await expect(service.setPrimary('co-1', 'c-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('rejects primary delete when other active contacts exist', async () => {
      prisma.financeCompanyContact.findFirst.mockResolvedValue({
        id: 'c-1', isPrimary: true, externalFinanceCompanyId: 'co-1', deletedAt: null,
      });
      prisma.financeCompanyContact.count.mockResolvedValue(1); // 1 other active contact

      await expect(service.softDelete('co-1', 'c-1')).rejects.toThrow(BadRequestException);
    });

    it('allows primary delete when no other active contacts', async () => {
      prisma.financeCompanyContact.findFirst.mockResolvedValue({
        id: 'c-1', isPrimary: true, externalFinanceCompanyId: 'co-1', deletedAt: null,
      });
      prisma.financeCompanyContact.count.mockResolvedValue(0);
      prisma.financeCompanyContact.update.mockResolvedValue({});

      await service.softDelete('co-1', 'c-1');
      expect(prisma.financeCompanyContact.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
