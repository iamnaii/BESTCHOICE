import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JournalService } from './journal.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Covers the T2-C1 fix: JournalService.create() must reject entries dated
 * inside a CLOSED or SYNCED accounting period. Without this guard, period
 * close was cosmetic — a manual entry could backdate into a closed month.
 */
describe('JournalService.create — period lock enforcement', () => {
  let service: JournalService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const companyId = 'company-1';

  const balancedDto = () => ({
    companyId,
    entryDate: '2026-04-10',
    description: 'test entry',
    lines: [
      { accountCode: '1100', description: 'debit', debit: 100, credit: 0 },
      { accountCode: '2100', description: 'credit', debit: 0, credit: 100 },
    ],
  });

  beforeEach(async () => {
    prisma = {
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: companyId, companyCode: 'BC' }),
      },
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: '1100', allowedCompanies: [] },
          { code: '2100', allowedCompanies: [] },
        ]),
      },
      journalEntry: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202604-0001' }),
      },
      accountingPeriod: {
        findUnique: jest.fn(),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (cb: (tx: any) => Promise<unknown>) =>
          cb({
            journalEntry: {
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202604-0001' }),
            },
          }),
      ),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [JournalService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(JournalService);
  });

  it('rejects a manual entry when the AccountingPeriod is CLOSED', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });

    await expect(service.create(balancedDto(), 'user-1')).rejects.toThrow(BadRequestException);
    await expect(service.create(balancedDto(), 'user-1')).rejects.toThrow(/ปิดแล้ว/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a manual entry when the AccountingPeriod is SYNCED', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'SYNCED' });

    await expect(service.create(balancedDto(), 'user-1')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows a manual entry when the AccountingPeriod is OPEN (or no record)', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue(null);

    await expect(service.create(balancedDto(), 'user-1')).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('allows a manual entry when the AccountingPeriod is REVIEW (soft lock)', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'REVIEW' });

    await expect(service.create(balancedDto(), 'user-1')).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('also rejects when legacy SystemConfig `accounting_period_closed_until` blocks the date', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue(null);
    prisma.systemConfig.findUnique.mockResolvedValue({
      key: 'accounting_period_closed_until',
      value: '2026-12-31',
    });

    await expect(service.create(balancedDto(), 'user-1')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
