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
    prisma.externalFinanceCompany.upsert.mockResolvedValue({ id: 'co-new' });
    prisma.financeReceivableContactLog.create.mockResolvedValue({ id: 'log-1' });
    prisma.financeReceivable.update.mockResolvedValue({});

    await service.record('rec-1', 'user-1', {
      result: FinanceContactResult.ANSWERED,
    });

    expect(prisma.externalFinanceCompany.upsert).toHaveBeenCalled();
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
