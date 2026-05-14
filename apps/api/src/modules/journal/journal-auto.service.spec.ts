import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Fix #C9 (Round 2 — blast-radius correction)
 *
 * History:
 *   - Initial Round 1 fix put `validatePeriodOpen` inside
 *     `JournalAutoService.createAndPost`. That caused payment + contract
 *     atomicity regressions: a reopened FINANCE period would reject a
 *     mid-tx JE write and roll back the Payment record (the JE was meant
 *     to be additive — not gating).
 *   - Round 2 (this PR): period guard moved to each module's service entry
 *     point (expense-documents.service.post + voidDocument). createAndPost
 *     is now purely structural — it asserts balanced JE + posts.
 *
 * What this spec covers:
 *   1. createAndPost still rejects unbalanced JEs (v4 regression guard).
 *   2. createAndPost does NOT itself call validatePeriodOpen — closed
 *      periods are filtered upstream by the module caller.
 *   3. createAndPost resolves FINANCE companyId when caller omits one.
 *
 * Expense module-level period-lock enforcement is covered by
 * expense-documents.service.spec.ts → "post() rejects closed period".
 */
describe('JournalAutoService.createAndPost — structural invariants (Fix #C9 Round 2)', () => {
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
      // Even with a CLOSED period in the DB, createAndPost itself does NOT
      // call validatePeriodOpen any more. These mocks exist only to detect
      // a regression — if the call ever sneaks back in, the test name
      // "does NOT call validatePeriodOpen" will fail.
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue({ status: 'CLOSED' }),
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

  it('Round 2 — does NOT call validatePeriodOpen even when period is CLOSED', async () => {
    // The guard moved upstream (expense-documents.service). createAndPost
    // is now purely structural. A closed period at this layer must NOT
    // throw — payment receipt JE writing into a reopened period must succeed.
    const result = await service.createAndPost(
      balancedInput(new Date('2026-04-10')),
      prisma,
    );
    expect(result.entryNumber).toBe('JE-202604-00001');
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(1);
    // Belt-and-braces: accountingPeriod.findUnique must NOT have been
    // queried by createAndPost (only the module-level caller queries it).
    expect(prisma.accountingPeriod.findUnique).not.toHaveBeenCalled();
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });

  it('still rejects unbalanced JEs (regression for v4 guard)', async () => {
    const unbalanced = balancedInput(new Date('2026-04-10'));
    unbalanced.lines[1].cr = new Decimal('50'); // Dr=100, Cr=50

    await expect(service.createAndPost(unbalanced, prisma)).rejects.toThrow(BadRequestException);
    await expect(service.createAndPost(unbalanced, prisma)).rejects.toThrow(/Unbalanced JE/);
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  it('resolves companyId to FINANCE when not provided', async () => {
    prisma.companyInfo.findFirst.mockResolvedValueOnce({ id: 'finance-co-id' });

    const inputWithoutCompany = {
      ...balancedInput(new Date('2026-04-10')),
    };
    delete (inputWithoutCompany as { companyId?: string }).companyId;

    const result = await service.createAndPost(inputWithoutCompany, prisma);
    expect(result.entryNumber).toBeDefined();
    expect(prisma.companyInfo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyCode: 'FINANCE' }),
      }),
    );
    expect(prisma.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: 'finance-co-id' }),
      }),
    );
  });
});
