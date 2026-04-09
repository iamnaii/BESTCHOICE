import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinanceReceivableService } from './finance-receivable.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FinanceReceivableService', () => {
  let service: FinanceReceivableService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      financeReceivable: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceReceivableService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FinanceReceivableService>(FinanceReceivableService);
  });

  describe('findAll', () => {
    it('always filters out soft-deleted rows', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      await service.findAll({});

      const arg = prisma.financeReceivable.findMany.mock.calls[0][0];
      expect(arg.where.deletedAt).toBeNull();
    });

    it('caps page size to 100 even when caller requests 1000', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      const result = await service.findAll({ limit: 1000 });
      expect(result.limit).toBe(100);
    });

    it('coerces page < 1 to 1', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      const result = await service.findAll({ page: -5 });
      expect(result.page).toBe(1);
    });

    it('builds an OR search clause across refNumber/bankRef/sale/customer', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      await service.findAll({ search: 'GFIN-123' });

      const arg = prisma.financeReceivable.findMany.mock.calls[0][0];
      expect(arg.where.OR).toBeDefined();
      expect(arg.where.OR).toHaveLength(4);
      expect(arg.where.OR[0].financeRefNumber.contains).toBe('GFIN-123');
    });

    it('passes branchId / status / financeCompany filters through verbatim', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      await service.findAll({ branchId: 'b1', status: 'PENDING', financeCompany: 'GFIN' });

      const arg = prisma.financeReceivable.findMany.mock.calls[0][0];
      expect(arg.where.branchId).toBe('b1');
      expect(arg.where.status).toBe('PENDING');
      expect(arg.where.financeCompany).toBe('GFIN');
    });

    it('expands endDate to end-of-day so the bound is inclusive', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      prisma.financeReceivable.count.mockResolvedValue(0);

      await service.findAll({ endDate: '2026-04-09' });

      const arg = prisma.financeReceivable.findMany.mock.calls[0][0];
      const lte = arg.where.expectedDate.lte as Date;
      expect(lte.getHours()).toBe(23);
      expect(lte.getMinutes()).toBe(59);
      expect(lte.getSeconds()).toBe(59);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when missing or soft-deleted', async () => {
      prisma.financeReceivable.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
      // verify it filters soft-deleted
      const where = prisma.financeReceivable.findFirst.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
    });
  });

  describe('recordReceive', () => {
    const baseRecord = {
      id: 'fr1',
      status: 'PENDING' as const,
      netExpectedAmount: new Prisma.Decimal('10000'),
      receivedAmount: null,
      note: 'old note',
    };

    beforeEach(() => {
      prisma.financeReceivable.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ ...baseRecord, ...data }),
      );
    });

    it('throws NotFoundException when record missing', async () => {
      prisma.financeReceivable.findFirst.mockResolvedValue(null);
      await expect(
        service.recordReceive('missing', { receivedAmount: 100, receivedDate: '2026-04-09', bankRef: 'TX1' }, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to record on an already RECEIVED row', async () => {
      prisma.financeReceivable.findFirst.mockResolvedValue({ ...baseRecord, status: 'RECEIVED' });
      await expect(
        service.recordReceive('fr1', { receivedAmount: 100, receivedDate: '2026-04-09', bankRef: 'TX1' }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks status RECEIVED when received >= expected', async () => {
      prisma.financeReceivable.findFirst.mockResolvedValue(baseRecord);

      await service.recordReceive(
        'fr1',
        { receivedAmount: 10000, receivedDate: '2026-04-09', bankRef: 'TX1' },
        'u1',
      );

      const data = prisma.financeReceivable.update.mock.calls[0][0].data;
      expect(data.status).toBe('RECEIVED');
    });

    it('marks status PARTIALLY_RECEIVED when received < expected', async () => {
      prisma.financeReceivable.findFirst.mockResolvedValue(baseRecord);

      await service.recordReceive(
        'fr1',
        { receivedAmount: 5000, receivedDate: '2026-04-09', bankRef: 'TX1' },
        'u1',
      );

      const data = prisma.financeReceivable.update.mock.calls[0][0].data;
      expect(data.status).toBe('PARTIALLY_RECEIVED');
    });

    it('still marks RECEIVED when received exceeds expected (no overpayment guard)', async () => {
      // Documents the current behavior — overpayment is ALLOWED.
      prisma.financeReceivable.findFirst.mockResolvedValue(baseRecord);

      await service.recordReceive(
        'fr1',
        { receivedAmount: 12000, receivedDate: '2026-04-09', bankRef: 'TX1' },
        'u1',
      );

      const data = prisma.financeReceivable.update.mock.calls[0][0].data;
      expect(data.status).toBe('RECEIVED');
    });

    it('preserves the original note when caller does not supply one', async () => {
      prisma.financeReceivable.findFirst.mockResolvedValue(baseRecord);

      await service.recordReceive(
        'fr1',
        { receivedAmount: 10000, receivedDate: '2026-04-09', bankRef: 'TX1' },
        'u1',
      );

      const data = prisma.financeReceivable.update.mock.calls[0][0].data;
      expect(data.note).toBe('old note');
    });

    it('records the receivedAmount as a Prisma.Decimal', async () => {
      prisma.financeReceivable.findFirst.mockResolvedValue(baseRecord);

      await service.recordReceive(
        'fr1',
        { receivedAmount: 9999.99, receivedDate: '2026-04-09', bankRef: 'TX1' },
        'u1',
      );

      const data = prisma.financeReceivable.update.mock.calls[0][0].data;
      expect(data.receivedAmount).toBeInstanceOf(Prisma.Decimal);
      expect((data.receivedAmount as Prisma.Decimal).toString()).toBe('9999.99');
    });
  });

  describe('update — commission rate recomputation', () => {
    it('recomputes commissionAmount and netExpectedAmount when commissionRate changes', async () => {
      prisma.financeReceivable.findFirst.mockResolvedValue({
        id: 'fr1',
        expectedAmount: new Prisma.Decimal('10000'),
      });
      prisma.financeReceivable.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => data,
      );

      await service.update('fr1', { commissionRate: 0.05 });

      const data = prisma.financeReceivable.update.mock.calls[0][0].data;
      // 10000 × 0.05 = 500 commission, net = 9500
      expect((data.commissionAmount as Prisma.Decimal).toString()).toBe('500');
      expect((data.netExpectedAmount as Prisma.Decimal).toString()).toBe('9500');
    });

    it('does NOT touch commission fields when commissionRate is undefined', async () => {
      prisma.financeReceivable.findFirst.mockResolvedValue({
        id: 'fr1',
        expectedAmount: new Prisma.Decimal('10000'),
      });
      prisma.financeReceivable.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => data,
      );

      await service.update('fr1', { note: 'updated' });

      const data = prisma.financeReceivable.update.mock.calls[0][0].data;
      expect(data.commissionRate).toBeUndefined();
      expect(data.commissionAmount).toBeUndefined();
      expect(data.netExpectedAmount).toBeUndefined();
      expect(data.note).toBe('updated');
    });
  });

  describe('getSummary', () => {
    it('aggregates by status with Decimal-precise sums', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([
        { status: 'PENDING', netExpectedAmount: new Prisma.Decimal('1000'), receivedAmount: null },
        { status: 'PENDING', netExpectedAmount: new Prisma.Decimal('500'), receivedAmount: null },
        { status: 'RECEIVED', netExpectedAmount: new Prisma.Decimal('2000'), receivedAmount: new Prisma.Decimal('2000') },
        { status: 'OVERDUE', netExpectedAmount: new Prisma.Decimal('800'), receivedAmount: new Prisma.Decimal('300') },
        { status: 'DISPUTED', netExpectedAmount: new Prisma.Decimal('700'), receivedAmount: null },
      ]);

      const summary = await service.getSummary();

      expect(summary.totalPending).toBe(2);
      expect(summary.totalReceived).toBe(1);
      expect(summary.totalOverdue).toBe(1);
      expect(summary.totalDisputed).toBe(1);
      // pending = 1000 + 500 = 1500 (received is null → 0)
      expect(summary.pendingAmount.toString()).toBe('1500');
      expect(summary.receivedAmount.toString()).toBe('2000');
      // overdue = 800 - 300 = 500
      expect(summary.overdueAmount.toString()).toBe('500');
      expect(summary.disputedAmount.toString()).toBe('700');
    });

    it('counts PARTIALLY_RECEIVED inside the Pending bucket', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([
        { status: 'PARTIALLY_RECEIVED', netExpectedAmount: new Prisma.Decimal('1000'), receivedAmount: new Prisma.Decimal('400') },
      ]);

      const summary = await service.getSummary();
      expect(summary.totalPending).toBe(1);
      expect(summary.pendingAmount.toString()).toBe('600');
    });

    it('filters by branchId when provided', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      await service.getSummary('b1');

      const where = prisma.financeReceivable.findMany.mock.calls[0][0].where;
      expect(where.branchId).toBe('b1');
      expect(where.deletedAt).toBeNull();
    });

    it('returns zeros for an empty dataset', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([]);
      const summary = await service.getSummary();
      expect(summary.totalPending).toBe(0);
      expect(summary.pendingAmount.toString()).toBe('0');
    });
  });

  describe('getFinanceCompanies', () => {
    it('returns distinct finance company names sorted ASC', async () => {
      prisma.financeReceivable.findMany.mockResolvedValue([
        { financeCompany: 'GFIN' },
        { financeCompany: 'KTC' },
      ]);

      const companies = await service.getFinanceCompanies();
      expect(companies).toEqual(['GFIN', 'KTC']);

      const arg = prisma.financeReceivable.findMany.mock.calls[0][0];
      expect(arg.distinct).toEqual(['financeCompany']);
      expect(arg.where.deletedAt).toBeNull();
    });
  });
});
