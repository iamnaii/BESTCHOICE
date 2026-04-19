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

/**
 * T2-C2: SoD — the accountant who drafted a journal entry can't also be
 * the one who posts it. System-generated entries (createdById=null) are
 * exempt.
 */
describe('JournalService.post — SoD enforcement', () => {
  let service: JournalService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const balancedEntry = (createdById: string | null) => ({
    id: 'je-1',
    status: 'DRAFT',
    createdById,
    lines: [
      { id: 'jl-1', debit: 100, credit: 0 },
      { id: 'jl-2', debit: 0, credit: 100 },
    ],
  });

  beforeEach(async () => {
    prisma = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(balancedEntry('u-author')),
        update: jest.fn((args) => Promise.resolve({ ...balancedEntry('u-author'), ...args.data })),
      },
      journalPostAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'jpal-1' }),
      },
      // post() now wraps update + audit insert in a $transaction so a
      // failed audit row rolls the post back.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb(prisma)),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [JournalService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(JournalService);
  });

  it('rejects self-post (drafter = poster)', async () => {
    await expect(service.post('je-1', 'u-author')).rejects.toThrow(BadRequestException);
    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
  });

  it('allows post when poster differs from drafter', async () => {
    await service.post('je-1', 'u-reviewer');
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'POSTED' }) }),
    );
  });

  it('allows system-generated entries (createdById=null) to be posted by anyone', async () => {
    prisma.journalEntry.findFirst.mockResolvedValue(balancedEntry(null));
    await service.post('je-1', 'u-anyone');
    expect(prisma.journalEntry.update).toHaveBeenCalled();
  });

  it('rejects posting an already-POSTED entry', async () => {
    prisma.journalEntry.findFirst.mockResolvedValue({
      ...balancedEntry('u-author'),
      status: 'POSTED',
    });
    await expect(service.post('je-1', 'u-reviewer')).rejects.toThrow(BadRequestException);
  });

  // T2-C14 — post() writes an immutable JournalPostAuditLog row in the
  // same $transaction. Failure of that insert rolls the post back.
  it('writes JournalPostAuditLog row in the same $transaction as the post', async () => {
    await service.post('je-1', 'u-reviewer', {
      ipAddress: '10.0.0.1',
      userAgent: 'jest',
    });
    expect(prisma.journalPostAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          journalEntryId: 'je-1',
          postedById: 'u-reviewer',
          ipAddress: '10.0.0.1',
          userAgent: 'jest',
        }),
      }),
    );
    // audit + update must share a transaction (both inside the $transaction cb)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rolls the post back if JournalPostAuditLog insert fails', async () => {
    prisma.journalPostAuditLog.create.mockRejectedValue(new Error('audit insert failed'));
    // Simulate transactional rollback: $transaction propagates the throw.
    await expect(service.post('je-1', 'u-reviewer')).rejects.toThrow(/audit insert failed/);
  });
});

/**
 * T2-C9: Voiding a POSTED journal entry must auto-create a reversal entry
 * (flipped debit/credit) in the same transaction. Previously status=VOIDED
 * silently removed the entry from trial balance with no forensic trail.
 */
describe('JournalService.void — auto-reversal (T2-C9)', () => {
  let service: JournalService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  const postedEntry = () => ({
    id: 'je-original',
    entryNumber: 'JE-202604-0001',
    companyId: 'company-1',
    entryDate: new Date('2026-04-10'),
    description: 'Expense',
    status: 'POSTED',
    lines: [
      { accountCode: '5100', description: 'debit side', debit: 100, credit: 0 },
      { accountCode: '1100', description: 'credit side', debit: 0, credit: 100 },
    ],
  });

  beforeEach(async () => {
    tx = {
      journalEntry: {
        update: jest.fn().mockResolvedValue({ ...postedEntry(), status: 'VOIDED' }),
        count: jest.fn().mockResolvedValue(5), // 5 existing entries this month → reversal = 0006
        create: jest.fn().mockResolvedValue({ id: 'je-reversal', entryNumber: 'JE-202604-0006' }),
      },
    };
    prisma = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(postedEntry()),
      },
      $transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [JournalService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(JournalService);
  });

  it('rejects void when entry is not POSTED', async () => {
    prisma.journalEntry.findFirst.mockResolvedValue({ ...postedEntry(), status: 'DRAFT' });
    await expect(service.void('je-original', 'u-owner')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('marks original entry as VOIDED', async () => {
    await service.void('je-original', 'u-owner');
    expect(tx.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'je-original' },
        data: { status: 'VOIDED' },
      }),
    );
  });

  it('creates a reversal entry with flipped debit/credit lines', async () => {
    await service.void('je-original', 'u-owner');
    const data = tx.journalEntry.create.mock.calls[0][0].data;
    expect(data.lines.create).toEqual([
      { accountCode: '5100', description: 'debit side', debit: 0, credit: 100 },
      { accountCode: '1100', description: 'credit side', debit: 100, credit: 0 },
    ]);
  });

  it('reversal entry is POSTED immediately (createdById=postedById=voider, no SoD since not DRAFT)', async () => {
    await service.void('je-original', 'u-owner');
    const data = tx.journalEntry.create.mock.calls[0][0].data;
    expect(data.status).toBe('POSTED');
    expect(data.createdById).toBe('u-owner');
    expect(data.postedById).toBe('u-owner');
    expect(data.postedAt).toBeInstanceOf(Date);
  });

  it('reversal entry references the original via referenceType=REVERSAL + referenceId', async () => {
    await service.void('je-original', 'u-owner');
    const data = tx.journalEntry.create.mock.calls[0][0].data;
    expect(data.referenceType).toBe('REVERSAL');
    expect(data.referenceId).toBe('je-original');
  });

  it('reversal entryDate = today (never back-dated into closed periods)', async () => {
    const before = Date.now();
    await service.void('je-original', 'u-owner');
    const after = Date.now();
    const data = tx.journalEntry.create.mock.calls[0][0].data;
    expect(data.entryDate).toBeInstanceOf(Date);
    expect((data.entryDate as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((data.entryDate as Date).getTime()).toBeLessThanOrEqual(after);
  });

  it('reversal description references the original entry number + text', async () => {
    await service.void('je-original', 'u-owner');
    const data = tx.journalEntry.create.mock.calls[0][0].data;
    expect(data.description).toBe('Reversal of JE-202604-0001: Expense');
  });

  it('reversal copies companyId from the original', async () => {
    await service.void('je-original', 'u-owner');
    const data = tx.journalEntry.create.mock.calls[0][0].data;
    expect(data.companyId).toBe('company-1');
  });

  it('both void + reversal happen in the same $transaction', async () => {
    await service.void('je-original', 'u-owner');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.journalEntry.update).toHaveBeenCalled();
    expect(tx.journalEntry.create).toHaveBeenCalled();
  });

  it('reversal entryNumber increments monthly sequence (count+1)', async () => {
    await service.void('je-original', 'u-owner');
    const data = tx.journalEntry.create.mock.calls[0][0].data;
    // count=5 → sequence 0006, prefix uses current YYYYMM
    expect(data.entryNumber).toMatch(/^JE-\d{6}-0006$/);
  });
});
