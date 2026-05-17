import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BankAccountsService } from '../bank-accounts.service';
import { PrismaService } from '../../../prisma/prisma.service';

type PrismaMock = {
  bankAccount: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
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
};

const makePrismaMock = (): PrismaMock => ({
  bankAccount: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
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
});

const sampleAccount = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'acc-1',
  accountCode: '11-1201',
  accountName: 'KBank ธนาคารกสิกรไทย',
  bankName: 'KBank',
  accountNumber: '123-4-56789-0',
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
      prisma.bankAccount.findUnique.mockResolvedValue(null);
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
