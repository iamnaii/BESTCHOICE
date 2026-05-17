import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BankAccountsService } from '../bank-accounts.service';
import { PrismaService } from '../../../prisma/prisma.service';

type PrismaMock = {
  bankAccount: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  journalLine: {
    findMany: jest.Mock;
    groupBy: jest.Mock;
    count: jest.Mock;
  };
  chartOfAccount: {
    findUnique: jest.Mock;
  };
  auditLog: {
    create: jest.Mock;
  };
};

const makePrismaMock = (): PrismaMock => ({
  bankAccount: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  journalLine: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  chartOfAccount: {
    findUnique: jest.fn(),
  },
  auditLog: {
    create: jest.fn().mockResolvedValue({}),
  },
});

const sampleAccount = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'acc-1',
  accountCode: '11-1201',
  accountName: 'ธนาคาร KBank',
  bankName: 'กสิกรไทย',
  accountNumber: '203-1-16520-5',
  accountType: 'SAVINGS',
  currency: 'THB',
  isActive: true,
  notes: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...overrides,
});

describe('BankAccountsService', () => {
  let service: BankAccountsService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankAccountsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(BankAccountsService);
  });

  describe('findAll', () => {
    it('returns every active account with its computed balance', async () => {
      prisma.bankAccount.findMany.mockResolvedValue([
        sampleAccount({ accountCode: '11-1101', accountType: 'CASH' }),
        sampleAccount({ accountCode: '11-1201' }),
      ]);
      prisma.journalLine.groupBy.mockResolvedValue([
        {
          accountCode: '11-1101',
          _sum: { debit: new Prisma.Decimal(500), credit: new Prisma.Decimal(100) },
        },
        {
          accountCode: '11-1201',
          _sum: { debit: new Prisma.Decimal(10000), credit: new Prisma.Decimal(2500) },
        },
      ]);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].balance).toBe('400.00');
      expect(result[1].balance).toBe('7500.00');
    });

    it('applies entryDate cutoff so future-dated postings are excluded (TB parity)', async () => {
      prisma.bankAccount.findMany.mockResolvedValue([
        sampleAccount({ accountCode: '11-1201' }),
      ]);
      prisma.journalLine.groupBy.mockResolvedValue([]);

      await service.findAll();

      const groupByCall = prisma.journalLine.groupBy.mock.calls[0][0];
      expect(groupByCall.where.journalEntry.entryDate).toBeDefined();
      expect(groupByCall.where.journalEntry.entryDate.lte).toBeInstanceOf(Date);
      // The cutoff must be "now-ish" — give a generous 5s window for slow CI.
      const cutoff = groupByCall.where.journalEntry.entryDate.lte as Date;
      expect(Math.abs(Date.now() - cutoff.getTime())).toBeLessThan(5000);
    });
  });

  describe('findByCode', () => {
    it('returns account + balance + recent transactions', async () => {
      prisma.bankAccount.findFirst.mockResolvedValue(sampleAccount());
      prisma.journalLine.groupBy.mockResolvedValue([
        {
          accountCode: '11-1201',
          _sum: { debit: new Prisma.Decimal(1000), credit: new Prisma.Decimal(250) },
        },
      ]);
      prisma.journalLine.findMany.mockResolvedValue([
        {
          id: 'jl-1',
          debit: new Prisma.Decimal(1000),
          credit: new Prisma.Decimal(0),
          journalEntry: {
            id: 'je-1',
            entryNumber: 'JE-202605-0001',
            entryDate: new Date('2026-05-10'),
          },
        },
      ]);

      const result = await service.findByCode('11-1201');

      expect(result.accountCode).toBe('11-1201');
      expect(result.balance).toBe('750.00');
      expect(result.recentTransactions).toHaveLength(1);
    });
  });

  describe('getTransactions', () => {
    it('paginates journal lines with total, page, limit', async () => {
      prisma.bankAccount.findFirst.mockResolvedValue(sampleAccount());
      prisma.journalLine.count.mockResolvedValue(75);
      prisma.journalLine.findMany.mockResolvedValue([
        { id: 'jl-1', debit: new Prisma.Decimal(500), credit: new Prisma.Decimal(0), journalEntry: {} },
      ]);

      const result = await service.getTransactions('11-1201', 2, 25);

      expect(result.total).toBe(75);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(25);
      expect(prisma.journalLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 25, take: 25 }),
      );
    });
  });

  describe('create', () => {
    it('validates code is a cash/bank CoA before inserting', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue({
        id: 'coa-1',
        code: '11-1204',
        name: 'KBank ออม',
        deletedAt: null,
      });
      prisma.bankAccount.findFirst.mockResolvedValue(null);
      prisma.bankAccount.create.mockImplementation(({ data }) =>
        Promise.resolve(sampleAccount({ ...data, id: 'new-1' })),
      );

      const result = await service.create(
        {
          accountCode: '11-1204',
          accountName: 'KBank ออม',
          bankName: 'KBank',
          accountType: 'SAVINGS',
        },
        'user-1',
      );

      expect(result.accountCode).toBe('11-1204');
      expect(prisma.chartOfAccount.findUnique).toHaveBeenCalledWith({
        where: { code: '11-1204' },
      });
    });

    it('writes BANK_ACCOUNT_CREATED audit log', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue({
        id: 'coa-1',
        code: '11-1204',
        name: 'KBank ออม',
        deletedAt: null,
      });
      prisma.bankAccount.findFirst.mockResolvedValue(null);
      prisma.bankAccount.create.mockImplementation(({ data }) =>
        Promise.resolve(sampleAccount({ ...data, id: 'new-1' })),
      );

      await service.create(
        {
          accountCode: '11-1204',
          accountName: 'KBank ออม',
          bankName: 'KBank',
          accountType: 'SAVINGS',
        },
        'user-7',
      );

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-7',
          action: 'BANK_ACCOUNT_CREATED',
          entity: 'bank_account',
          entityId: 'new-1',
          newValue: expect.objectContaining({
            accountCode: '11-1204',
            accountName: 'KBank ออม',
          }),
        }),
      });
    });

    it('rejects non-cash/bank codes', async () => {
      await expect(
        service.create(
          {
            accountCode: '21-1101',
            accountName: 'เจ้าหนี้',
            bankName: 'n/a',
          },
          'user-1',
        ),
      ).rejects.toThrow(/ไม่ใช่บัญชีเงินสด\/ธนาคาร/);
    });

    it('rejects when an active row with the same code already exists', async () => {
      prisma.chartOfAccount.findUnique.mockResolvedValue({
        id: 'coa-1',
        code: '11-1201',
        name: 'KBank',
        deletedAt: null,
      });
      prisma.bankAccount.findFirst.mockResolvedValue(sampleAccount());

      await expect(
        service.create(
          {
            accountCode: '11-1201',
            accountName: 'KBank ซ้ำ',
            bankName: 'KBank',
          },
          'user-1',
        ),
      ).rejects.toThrow(/มีบัญชีรหัส 11-1201 อยู่แล้ว/);
    });
  });

  describe('update', () => {
    it('writes BANK_ACCOUNT_UPDATED with old/new diff for changed fields only', async () => {
      prisma.bankAccount.findFirst.mockResolvedValue(sampleAccount());
      prisma.bankAccount.update.mockImplementation(({ data }) =>
        Promise.resolve(sampleAccount({ ...data })),
      );

      await service.update(
        '11-1201',
        { bankName: 'กสิกรไทย NEW', notes: 'ปรับชื่อ' },
        'user-9',
      );

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-9',
          action: 'BANK_ACCOUNT_UPDATED',
          entity: 'bank_account',
          oldValue: { bankName: 'กสิกรไทย', notes: null },
          newValue: { bankName: 'กสิกรไทย NEW', notes: 'ปรับชื่อ' },
        }),
      });
    });

    it('no-op PATCH (all unchanged) does not write an audit log', async () => {
      prisma.bankAccount.findFirst.mockResolvedValue(sampleAccount());
      prisma.bankAccount.update.mockResolvedValue(sampleAccount());

      await service.update('11-1201', {}, 'user-9');

      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    it('soft-deletes + flips isActive + writes BANK_ACCOUNT_DISABLED audit log', async () => {
      prisma.bankAccount.findFirst.mockResolvedValue(sampleAccount());
      prisma.bankAccount.update.mockImplementation(({ data }) =>
        Promise.resolve(sampleAccount({ ...data })),
      );

      await service.disable('11-1201', 'user-3');

      expect(prisma.bankAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false, deletedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-3',
          action: 'BANK_ACCOUNT_DISABLED',
          entity: 'bank_account',
        }),
      });
    });
  });

  describe('balance calculation accuracy', () => {
    it('handles missing groupBy rows by returning 0.00 for those codes', async () => {
      prisma.bankAccount.findMany.mockResolvedValue([
        sampleAccount({ accountCode: '11-1101', accountType: 'CASH' }),
        sampleAccount({ accountCode: '11-1102', accountType: 'CASH' }),
      ]);
      prisma.journalLine.groupBy.mockResolvedValue([
        {
          accountCode: '11-1101',
          _sum: { debit: new Prisma.Decimal('123.45'), credit: new Prisma.Decimal('23.45') },
        },
        // 11-1102 has no postings yet → omitted from groupBy result
      ]);

      const result = await service.findAll();

      const balances = Object.fromEntries(result.map((a) => [a.accountCode, a.balance]));
      expect(balances['11-1101']).toBe('100.00');
      expect(balances['11-1102']).toBe('0.00');
    });
  });
});
