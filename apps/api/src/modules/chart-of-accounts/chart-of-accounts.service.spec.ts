import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountGroup } from '@prisma/client';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ChartOfAccountsService', () => {
  let service: ChartOfAccountsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      chartOfAccount: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      journalLine: {
        count: jest.fn(),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ChartOfAccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(ChartOfAccountsService);
  });

  describe('findAll', () => {
    it('returns active accounts ordered by code with soft-delete filter', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([{ id: 'a1' }]);
      await service.findAll();
      expect(prisma.chartOfAccount.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { code: 'asc' },
      });
    });

    it('adds accountGroup filter when group is provided', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([]);
      await service.findAll({ group: AccountGroup.ASSET });
      const call = prisma.chartOfAccount.findMany.mock.calls[0][0];
      expect(call.where.accountGroup).toBe(AccountGroup.ASSET);
    });

    it('respects explicit active=false (not just truthy)', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([]);
      await service.findAll({ active: false });
      const call = prisma.chartOfAccount.findMany.mock.calls[0][0];
      expect(call.where.isActive).toBe(false);
    });

    it('builds case-insensitive OR search across code/nameTh/nameEn when q is set', async () => {
      prisma.chartOfAccount.findMany.mockResolvedValue([]);
      await service.findAll({ q: 'cash' });
      const call = prisma.chartOfAccount.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { code: { contains: 'cash', mode: 'insensitive' } },
        { nameTh: { contains: 'cash', mode: 'insensitive' } },
        { nameEn: { contains: 'cash', mode: 'insensitive' } },
      ]);
    });
  });

  describe('findOne', () => {
    it('returns account when found', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue({ id: 'a1', code: '11-1101' });
      await expect(service.findOne('a1')).resolves.toEqual({ id: 'a1', code: '11-1101' });
    });

    it('throws NotFoundException (Thai message) when account missing', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findOne('missing')).rejects.toMatchObject({
        message: 'ไม่พบบัญชี',
      });
    });
  });

  describe('create', () => {
    const baseDto = {
      code: '11-1101',
      nameTh: 'เงินสด',
      accountGroup: AccountGroup.ASSET,
    };

    it('rejects duplicate code with ConflictException', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue({ id: 'existing', code: '11-1101' });
      await expect(service.create(baseDto as any)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects unknown parentCode with BadRequestException', async () => {
      prisma.chartOfAccount.findUnique
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValueOnce(null); // parent lookup
      await expect(
        service.create({ ...baseDto, parentCode: '11-1000' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults peakAccountCode to code when omitted', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue(null);
      prisma.chartOfAccount.create.mockResolvedValue({ id: 'a1' });
      await service.create(baseDto as any);
      const call = prisma.chartOfAccount.create.mock.calls[0][0];
      expect(call.data.peakAccountCode).toBe('11-1101');
    });

    it('preserves explicit peakAccountCode when provided', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue(null);
      prisma.chartOfAccount.create.mockResolvedValue({ id: 'a1' });
      await service.create({ ...baseDto, peakAccountCode: 'PEAK-1101' } as any);
      const call = prisma.chartOfAccount.create.mock.calls[0][0];
      expect(call.data.peakAccountCode).toBe('PEAK-1101');
    });

    it('defaults level to 3 and isActive to true when omitted', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue(null);
      prisma.chartOfAccount.create.mockResolvedValue({ id: 'a1' });
      await service.create(baseDto as any);
      const call = prisma.chartOfAccount.create.mock.calls[0][0];
      expect(call.data.level).toBe(3);
      expect(call.data.isActive).toBe(true);
      expect(call.data.allowedCompanies).toEqual([]);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when target account missing', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', { nameTh: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects update with unknown parentCode', async () => {
      prisma.chartOfAccount.findUnique
        .mockResolvedValueOnce({ id: 'a1', code: '11-1101' }) // findOne
        .mockResolvedValueOnce(null); // parent lookup
      await expect(
        service.update('a1', { parentCode: '99-9999' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('passes dto straight through to update when valid', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue({ id: 'a1', code: '11-1101' });
      prisma.chartOfAccount.update.mockResolvedValue({ id: 'a1', nameTh: 'เงินสดและเทียบเท่า' });
      await service.update('a1', { nameTh: 'เงินสดและเทียบเท่า' });
      expect(prisma.chartOfAccount.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { nameTh: 'เงินสดและเทียบเท่า' },
      });
    });
  });

  describe('remove', () => {
    const targetAccount = { id: 'a1', code: '11-1101' };

    it('soft-disables (isActive=false) when journal lines reference the code', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue(targetAccount);
      prisma.journalLine.count.mockResolvedValue(42);
      prisma.chartOfAccount.update.mockResolvedValue({ ...targetAccount, isActive: false });

      await service.remove('a1');
      expect(prisma.chartOfAccount.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { isActive: false },
      });
    });

    it('blocks delete with BadRequestException when child accounts exist', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue(targetAccount);
      prisma.journalLine.count.mockResolvedValue(0);
      prisma.chartOfAccount.count.mockResolvedValue(3);

      await expect(service.remove('a1')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.remove('a1')).rejects.toMatchObject({
        message: 'มีบัญชีย่อยอยู่ ลบไม่ได้',
      });
    });

    it('soft-deletes (sets deletedAt) when no journal lines and no children', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue(targetAccount);
      prisma.journalLine.count.mockResolvedValue(0);
      prisma.chartOfAccount.count.mockResolvedValue(0);
      prisma.chartOfAccount.update.mockResolvedValue({ ...targetAccount, deletedAt: new Date() });

      await service.remove('a1');
      const call = prisma.chartOfAccount.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'a1' });
      expect(call.data.deletedAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when account does not exist', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
