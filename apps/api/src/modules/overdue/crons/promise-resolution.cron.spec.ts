import { Test } from '@nestjs/testing';
import { PromiseResolutionCron } from './promise-resolution.cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('PromiseResolutionCron', () => {
  let cron: PromiseResolutionCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let mdm: any;

  beforeEach(async () => {
    // C3 fix: resolvePromise now wraps all DB writes in prisma.$transaction.
    // The tx object passed to the callback must expose the same table methods.
    const txMock: any = {
      callLog: { update: jest.fn().mockResolvedValue({}) },
      promiseSlot: { update: jest.fn().mockResolvedValue({}) },
      contract: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      callLog: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      promiseSlot: { update: jest.fn().mockResolvedValue({}) },
      contract: { update: jest.fn().mockResolvedValue({}) },
      payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: null } }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'sys-uid' }) },
      // Expose the transaction callback + forward calls to txMock so assertions still work.
      $transaction: jest.fn(async (cb: any) => cb(txMock)),
      __tx: txMock,
    };
    mdm = { autoLock: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        PromiseResolutionCron,
        { provide: PrismaService, useValue: prisma },
        { provide: MdmLockService, useValue: mdm },
      ],
    }).compile();
    cron = module.get(PromiseResolutionCron);
  });

  it('marks slot kept when paidAmount >= settlementAmount in window', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        slots: [
          {
            id: 's-1',
            slotIndex: 1,
            settlementDate: new Date(Date.now() - 2 * 86400 * 1000),
            settlementAmount: { toNumber: () => 1000 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      },
    ]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: { toNumber: () => 1500 } } });

    await cron.handleHourly();

    // C3: DB writes now happen inside prisma.$transaction → assert on tx mock
    expect(prisma.__tx.promiseSlot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's-1' },
        data: expect.objectContaining({ keptAt: expect.any(Date) }),
      }),
    );
  });

  it('marks promise broken + triggers MDM lock + writes BROKEN_PROMISE audit', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        slots: [
          {
            id: 's-1',
            slotIndex: 1,
            settlementDate: new Date(Date.now() - 2 * 86400 * 1000),
            settlementAmount: { toNumber: () => 1000 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      },
    ]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: { toNumber: () => 500 } } });

    await cron.handleHourly();

    // C3: DB writes now happen inside prisma.$transaction → assert on tx mock
    expect(prisma.__tx.promiseSlot.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokenAt: expect.any(Date) }) }),
    );
    expect(prisma.__tx.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cl-1' },
        data: expect.objectContaining({ brokenAt: expect.any(Date) }),
      }),
    );
    expect(prisma.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BROKEN_PROMISE',
          entityId: 'c-1',
        }),
      }),
    );
    // MDM autoLock is outside the transaction (external API call)
    expect(mdm.autoLock).toHaveBeenCalledWith(
      'c-1',
      expect.stringContaining('SLOT_BROKEN'),
      expect.anything(),
    );
  });

  it('marks promise kept + increments keptPromiseCount when ALL slots kept', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        slots: [
          {
            id: 's-1',
            slotIndex: 1,
            settlementDate: new Date(Date.now() - 5 * 86400 * 1000),
            settlementAmount: { toNumber: () => 1000 },
            keptAt: new Date(),
            brokenAt: null,
          },
          {
            id: 's-2',
            slotIndex: 2,
            settlementDate: new Date(Date.now() - 2 * 86400 * 1000),
            settlementAmount: { toNumber: () => 500 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      },
    ]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: { toNumber: () => 600 } } });

    await cron.handleHourly();

    // C3: DB writes now happen inside prisma.$transaction → assert on tx mock
    expect(prisma.__tx.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cl-1' },
        data: expect.objectContaining({ keptAt: expect.any(Date) }),
      }),
    );
    expect(prisma.__tx.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { keptPromiseCount: { increment: 1 } },
      }),
    );
  });
});
