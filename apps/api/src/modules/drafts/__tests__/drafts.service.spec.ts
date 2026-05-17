import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { DraftsService } from '../drafts.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('DraftsService', () => {
  let service: DraftsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      quote: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'q-1',
            quoteNumber: 'QU-20260517-0001',
            total: new Prisma.Decimal(45980),
            createdAt: new Date('2026-05-17T10:00:00Z'),
            customer: { name: 'นาย ก' },
            branch: { name: 'สาขาลาดพร้าว' },
            createdBy: { name: 'พนักงาน X' },
          },
        ]),
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c-1',
            contractNumber: 'BCP2605-00010',
            financedAmount: new Prisma.Decimal(20000),
            createdAt: new Date('2026-05-16T10:00:00Z'),
            customer: { name: 'นาย ข' },
            branch: { name: 'สาขาลาดพร้าว' },
            salesperson: { name: 'พนักงาน Y' },
          },
        ]),
      },
      expenseDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e-1',
            number: 'EX-20260515-0001',
            vendorName: 'AIS',
            totalAmount: new Prisma.Decimal(2500),
            createdAt: new Date('2026-05-15T10:00:00Z'),
            branch: { name: 'สาขาลาดพร้าว' },
            createdBy: { name: 'พนักงาน Z' },
          },
        ]),
      },
      otherIncome: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'oi-1',
            docNumber: 'OI-20260514-0001',
            totalAmount: new Prisma.Decimal(150),
            createdAt: new Date('2026-05-14T10:00:00Z'),
            customer: null,
            counterpartyName: 'KBank',
          },
        ]),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [DraftsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(DraftsService);
  });

  it('federates across 4 tables — returns unified DraftRow shape, sorted desc by createdAt', async () => {
    const result = await service.findAll({});
    expect(result.data).toHaveLength(4);
    expect(result.data[0].type).toBe('QUOTE'); // newest
    expect(result.data[1].type).toBe('CONTRACT');
    expect(result.data[2].type).toBe('EXPENSE');
    expect(result.data[3].type).toBe('OTHER_INCOME');

    expect(result.data[0]).toMatchObject({
      number: 'QU-20260517-0001',
      customerName: 'นาย ก',
      branchName: 'สาขาลาดพร้าว',
      amount: 45980,
      link: '/quotes/q-1',
    });
  });

  it('type filter — narrows to a single source', async () => {
    const result = await service.findAll({ type: 'CONTRACT' });
    expect(prisma.quote.findMany).not.toHaveBeenCalled();
    expect(prisma.expenseDocument.findMany).not.toHaveBeenCalled();
    expect(prisma.otherIncome.findMany).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].type).toBe('CONTRACT');
  });

  it('branch scoping — passes branchId to Quote/Contract/Expense + skips OtherIncome', async () => {
    await service.findAll({ branchId: 'br-1' });
    expect(prisma.quote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: 'br-1' }) }),
    );
    expect(prisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: 'br-1' }) }),
    );
    expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: 'br-1' }) }),
    );
    // OtherIncome has no branchId — never called when branch filter is set
    expect(prisma.otherIncome.findMany).not.toHaveBeenCalled();
  });
});
