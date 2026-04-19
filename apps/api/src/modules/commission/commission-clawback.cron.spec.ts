import { Test } from '@nestjs/testing';
import { CommissionClawbackCron } from './commission-clawback.cron';
import { CommissionService } from './commission.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('CommissionClawbackCron (T1-C6)', () => {
  let cron: CommissionClawbackCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let commission: any;

  beforeEach(async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    prisma = {
      contract: { findMany: jest.fn() },
      payment: { count: jest.fn() },
    };
    commission = {
      applyClawbackForContract: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        CommissionClawbackCron,
        { provide: PrismaService, useValue: prisma },
        { provide: CommissionService, useValue: commission },
      ],
    }).compile();
    cron = mod.get(CommissionClawbackCron);
  });

  it('returns zero-counts when no DEFAULT/CLOSED_BAD_DEBT contracts have pending clawback', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    const result = await cron.runDailyClawback();
    expect(result).toEqual({ processed: 0, clawedBackCount: 0, errors: 0 });
    expect(commission.applyClawbackForContract).not.toHaveBeenCalled();
  });

  it('queries only DEFAULT + CLOSED_BAD_DEBT contracts with unclawed commissions', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    await cron.runDailyClawback();
    const call = prisma.contract.findMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ['DEFAULT', 'CLOSED_BAD_DEBT'] });
    expect(call.where.commissions).toEqual({
      some: {
        deletedAt: null,
        status: { in: ['APPROVED', 'PAID'] },
        clawbackAt: null,
      },
    });
    expect(call.where.deletedAt).toBe(null);
  });

  it('counts PAID payments per contract and passes to applyClawbackForContract', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', contractNumber: 'HP-0001', status: 'DEFAULT' },
    ]);
    prisma.payment.count.mockResolvedValue(3);
    commission.applyClawbackForContract.mockResolvedValue({
      clawedBackCount: 2,
      totalAmount: '1500.00',
      percent: 75,
    });

    const result = await cron.runDailyClawback();

    expect(prisma.payment.count).toHaveBeenCalledWith({
      where: { contractId: 'c1', status: 'PAID', deletedAt: null },
    });
    expect(commission.applyClawbackForContract).toHaveBeenCalledWith(
      'c1',
      3,
      expect.stringContaining('DEFAULT'),
    );
    expect(result.processed).toBe(1);
    expect(result.clawedBackCount).toBe(2);
  });

  it('sums clawedBackCount across multiple contracts', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', contractNumber: 'HP-0001', status: 'DEFAULT' },
      { id: 'c2', contractNumber: 'HP-0002', status: 'CLOSED_BAD_DEBT' },
    ]);
    prisma.payment.count.mockResolvedValueOnce(1).mockResolvedValueOnce(12);
    commission.applyClawbackForContract
      .mockResolvedValueOnce({ clawedBackCount: 1, totalAmount: '1000', percent: 100 })
      .mockResolvedValueOnce({ clawedBackCount: 3, totalAmount: '750', percent: 25 });

    const result = await cron.runDailyClawback();
    expect(result.processed).toBe(2);
    expect(result.clawedBackCount).toBe(4);
    expect(result.errors).toBe(0);
  });

  it('continues processing remaining contracts when one throws + Sentry captures', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', contractNumber: 'HP-BAD', status: 'DEFAULT' },
      { id: 'c2', contractNumber: 'HP-OK', status: 'DEFAULT' },
    ]);
    prisma.payment.count.mockResolvedValue(5);
    commission.applyClawbackForContract
      .mockRejectedValueOnce(new Error('tx deadlock'))
      .mockResolvedValueOnce({ clawedBackCount: 2, totalAmount: '500', percent: 50 });

    const result = await cron.runDailyClawback();
    expect(result.processed).toBe(1);
    expect(result.clawedBackCount).toBe(2);
    expect(result.errors).toBe(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ contractNumber: 'HP-BAD' }),
      }),
    );
  });

  it('uses idempotency via applyClawbackForContract (returns 0 on already-clawed)', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', contractNumber: 'HP-0001', status: 'DEFAULT' },
    ]);
    prisma.payment.count.mockResolvedValue(4);
    commission.applyClawbackForContract.mockResolvedValue({
      clawedBackCount: 0,
      totalAmount: '0',
      percent: 50,
    });

    const result = await cron.runDailyClawback();
    expect(result.processed).toBe(1);
    expect(result.clawedBackCount).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('caps batch at 500 contracts (safety limit)', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    await cron.runDailyClawback();
    const call = prisma.contract.findMany.mock.calls[0][0];
    expect(call.take).toBe(500);
  });

  it('swallows top-level DB failure + Sentry capture (cron never throws)', async () => {
    prisma.contract.findMany.mockRejectedValue(new Error('db down'));
    const result = await cron.runDailyClawback();
    expect(result).toEqual({ processed: 0, clawedBackCount: 0, errors: 0 });
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ cron: 'commission-clawback' }),
      }),
    );
  });

  it('reason string includes triggering contract status (DEFAULT vs CLOSED_BAD_DEBT)', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', contractNumber: 'HP-1', status: 'CLOSED_BAD_DEBT' },
    ]);
    prisma.payment.count.mockResolvedValue(0);
    commission.applyClawbackForContract.mockResolvedValue({
      clawedBackCount: 1,
      totalAmount: '1',
      percent: 100,
    });

    await cron.runDailyClawback();
    const [, , reason] = commission.applyClawbackForContract.mock.calls[0];
    expect(reason).toContain('CLOSED_BAD_DEBT');
  });
});
