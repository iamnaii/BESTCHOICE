import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Fix #C9 — createAndPost must enforce validatePeriodOpen before writing
 * a JournalEntry. Without this guard, expense post/void, payroll, settlement,
 * credit-note, and all other automated JE templates could write into CLOSED
 * accounting periods (backdating after period close). Manual JournalService.create
 * has had this guard since v4; auto-generated entries now match.
 */
describe('JournalAutoService.createAndPost — period lock enforcement (Fix #C9)', () => {
  let service: JournalAutoService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const companyId = 'company-finance-1';

  const balancedInput = (postedAt: Date) => ({
    description: 'test JE',
    postedAt,
    companyId,
    lines: [
      { accountCode: '11-1101', dr: new Decimal('100'), cr: new Decimal('0') },
      { accountCode: '21-1101', dr: new Decimal('0'), cr: new Decimal('100') },
    ],
  });

  beforeEach(async () => {
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: '11-1101', id: 'acct-cash' },
          { code: '21-1101', id: 'acct-ap' },
        ]),
      },
      journalEntry: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'je-uuid-1', entryNumber: 'JE-202604-00001' }),
      },
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: companyId }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'user-system' }),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [JournalAutoService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(JournalAutoService);
  });

  it('rejects auto JE when AccountingPeriod for postedAt is CLOSED', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });

    await expect(
      service.createAndPost(balancedInput(new Date('2026-04-10')), prisma),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createAndPost(balancedInput(new Date('2026-04-10')), prisma),
    ).rejects.toThrow(/ปิดแล้ว/);

    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  it('rejects auto JE when AccountingPeriod is SYNCED', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'SYNCED' });

    await expect(
      service.createAndPost(balancedInput(new Date('2026-04-10')), prisma),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  it('allows auto JE when AccountingPeriod is OPEN / not found', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue(null);

    const result = await service.createAndPost(balancedInput(new Date('2026-04-10')), prisma);
    expect(result.entryNumber).toBe('JE-202604-00001');
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(1);
  });

  it('also rejects when legacy SystemConfig `accounting_period_closed_until` blocks the date', async () => {
    prisma.accountingPeriod.findUnique.mockResolvedValue(null);
    prisma.systemConfig.findUnique.mockResolvedValue({
      key: 'accounting_period_closed_until',
      value: '2026-12-31',
    });

    await expect(
      service.createAndPost(balancedInput(new Date('2026-04-10')), prisma),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  it('still rejects unbalanced JEs (regression for v4 guard)', async () => {
    const unbalanced = balancedInput(new Date('2026-04-10'));
    unbalanced.lines[1].cr = new Decimal('50'); // Dr=100, Cr=50

    await expect(service.createAndPost(unbalanced, prisma)).rejects.toThrow(BadRequestException);
    await expect(service.createAndPost(unbalanced, prisma)).rejects.toThrow(/Unbalanced JE/);
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  // companyId resolution: when not provided, defaults to FINANCE. Verifies
  // period check runs against the resolved companyId, not undefined.
  it('resolves companyId to FINANCE when not provided, then validates period', async () => {
    prisma.companyInfo.findFirst.mockResolvedValueOnce({ id: 'finance-co-id' });
    prisma.accountingPeriod.findUnique.mockResolvedValue({ status: 'CLOSED' });

    const inputWithoutCompany = {
      ...balancedInput(new Date('2026-04-10')),
    };
    delete (inputWithoutCompany as { companyId?: string }).companyId;

    await expect(service.createAndPost(inputWithoutCompany, prisma)).rejects.toThrow(/ปิดแล้ว/);
    // validatePeriodOpen must have been called with the resolved companyId
    expect(prisma.accountingPeriod.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId_year_month: expect.objectContaining({ companyId: 'finance-co-id' }),
        }),
      }),
    );
  });
});
