// finance-receivable-contact-logs.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FinanceReceivableContactLogsService } from './finance-receivable-contact-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceContactResult, FinanceContactChannel } from '@prisma/client';

describe('FinanceReceivableContactLogsService — record', () => {
  let service: FinanceReceivableContactLogsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      financeReceivable: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      externalFinanceCompany: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'co-new' }),
      },
      financeReceivableContactLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceReceivableContactLogsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = mod.get(FinanceReceivableContactLogsService);
  });

  it('throws NotFound when receivable does not exist', async () => {
    prisma.financeReceivable.findFirst.mockResolvedValue(null);
    await expect(
      service.record('rec-1', 'user-1', {
        result: FinanceContactResult.ANSWERED,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lazy-upserts ExternalFinanceCompany when FK is null', async () => {
    prisma.financeReceivable.findFirst.mockResolvedValue({
      id: 'rec-1',
      externalFinanceCompanyId: null,
      financeCompany: 'KTC Finance',
      contactAttemptCount: 0,
      lastPromisedDate: null,
    });
    prisma.externalFinanceCompany.findMany.mockResolvedValue([]);
    prisma.externalFinanceCompany.create.mockResolvedValue({ id: 'co-new' });
    prisma.financeReceivableContactLog.create.mockResolvedValue({ id: 'log-1' });
    prisma.financeReceivable.update.mockResolvedValue({});

    await service.record('rec-1', 'user-1', {
      result: FinanceContactResult.ANSWERED,
    });

    expect(prisma.externalFinanceCompany.create).toHaveBeenCalled();
    const created = prisma.financeReceivableContactLog.create.mock.calls[0][0].data;
    expect(created.externalFinanceCompanyId).toBe('co-new');
  });

  it('updates KPI denorm: lastContactedAt + contactAttemptCount + lastPromisedDate when PROMISED', async () => {
    prisma.financeReceivable.findFirst.mockResolvedValue({
      id: 'rec-1',
      externalFinanceCompanyId: 'co-1',
      financeCompany: 'KTC',
      contactAttemptCount: 2,
      lastPromisedDate: null,
    });
    prisma.financeReceivableContactLog.create.mockResolvedValue({ id: 'log-1' });
    prisma.financeReceivable.update.mockResolvedValue({});

    await service.record('rec-1', 'user-1', {
      result: FinanceContactResult.PROMISED,
      promisedDate: '2026-06-15',
      promisedAmount: 12000,
    });

    const updateArg = prisma.financeReceivable.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe('rec-1');
    expect(updateArg.data.contactAttemptCount).toBe(3);
    expect(updateArg.data.lastContactedAt).toBeInstanceOf(Date);
    expect(updateArg.data.lastPromisedDate).toBeInstanceOf(Date);
  });

  it('does not overwrite lastPromisedDate when result is not PROMISED', async () => {
    const existing = new Date('2026-06-01');
    prisma.financeReceivable.findFirst.mockResolvedValue({
      id: 'rec-1',
      externalFinanceCompanyId: 'co-1',
      financeCompany: 'KTC',
      contactAttemptCount: 1,
      lastPromisedDate: existing,
    });
    prisma.financeReceivableContactLog.create.mockResolvedValue({ id: 'log-1' });

    await service.record('rec-1', 'user-1', {
      result: FinanceContactResult.NO_ANSWER,
    });

    const updateArg = prisma.financeReceivable.update.mock.calls[0][0];
    expect(updateArg.data.lastPromisedDate).toEqual(existing);
  });
});

// suppress unused import warning for FinanceContactChannel (used in DTO type)
void FinanceContactChannel;

describe('FinanceReceivableContactLogsService — list/update/delete', () => {
  let service: FinanceReceivableContactLogsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      financeReceivableContactLog: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      financeReceivable: { findFirst: jest.fn(), update: jest.fn() },
      externalFinanceCompany: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        FinanceReceivableContactLogsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(FinanceReceivableContactLogsService);
  });

  it('list returns logs ordered newest first with contact + user joined', async () => {
    prisma.financeReceivableContactLog.findMany.mockResolvedValue([]);
    await service.list('rec-1');
    const arg = prisma.financeReceivableContactLog.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ financeReceivableId: 'rec-1', deletedAt: null });
    expect(arg.orderBy).toEqual({ contactedAt: 'desc' });
    expect(arg.include).toMatchObject({
      contact: { select: expect.any(Object) },
      contactedBy: { select: expect.any(Object) },
    });
  });

  it('update rejects when user is not author + not OWNER/FINANCE_MANAGER', async () => {
    prisma.financeReceivableContactLog.findFirst.mockResolvedValue({
      id: 'log-1',
      contactedById: 'other-user',
      createdAt: new Date(),
    });
    await expect(
      service.update('rec-1', 'log-1', 'user-1', 'ACCOUNTANT', { notes: 'x' }),
    ).rejects.toThrow(/แก้ไขได้เฉพาะเจ้าของ/);
  });

  it('update rejects when own log but past 24h window', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    prisma.financeReceivableContactLog.findFirst.mockResolvedValue({
      id: 'log-1',
      contactedById: 'user-1',
      createdAt: old,
    });
    await expect(
      service.update('rec-1', 'log-1', 'user-1', 'ACCOUNTANT', { notes: 'x' }),
    ).rejects.toThrow(/24/);
  });

  it('update allows OWNER any time', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    prisma.financeReceivableContactLog.findFirst.mockResolvedValue({
      id: 'log-1',
      contactedById: 'someone',
      createdAt: old,
    });
    prisma.financeReceivableContactLog.update.mockResolvedValue({});
    await expect(
      service.update('rec-1', 'log-1', 'owner-1', 'OWNER', { notes: 'x' }),
    ).resolves.toBeDefined();
  });
});
