import { Test } from '@nestjs/testing';
import { PromiseService } from './promise.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PromiseService.calcCycleDeadline', () => {
  let service: PromiseService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { payment: { findMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [
        PromiseService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PromiseService);
  });

  it('returns the next future installment dueDate', async () => {
    const today = new Date('2026-04-27');
    prisma.payment.findMany.mockResolvedValue([
      { dueDate: new Date('2026-03-01') }, // past
      { dueDate: new Date('2026-05-01') }, // future, nearest
      { dueDate: new Date('2026-06-01') },
    ]);
    const deadline = await service.calcCycleDeadline('contract-1', today);
    expect(deadline.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('falls back to last day of next calendar month when all installments overdue', async () => {
    const today = new Date('2026-04-27');
    prisma.payment.findMany.mockResolvedValue([
      { dueDate: new Date('2026-01-01') },
      { dueDate: new Date('2026-02-01') },
    ]);
    const deadline = await service.calcCycleDeadline('contract-1', today);
    // last day of May 2026 = 2026-05-31
    expect(deadline.toISOString().slice(0, 10)).toBe('2026-05-31');
  });
});

describe('PromiseService.createPromise (supersede + reschedule)', () => {
  let service: PromiseService;
  let prisma: any;

  beforeEach(async () => {
    const tx: any = {
      callLog: {
        // C2 fix: findFirst now uses tx inside the transaction, so mock it here.
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'new-cl' }),
      },
      contract: { update: jest.fn().mockResolvedValue({}) },
      promiseSlot: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      // prisma.callLog.findFirst is no longer called directly (C2 fix) — only tx is.
      callLog: {
        findFirst: jest.fn(),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      __tx: tx,
    };
    const module = await Test.createTestingModule({
      providers: [PromiseService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(PromiseService);
  });

  it('first promise (no active) — rescheduleCount=0, no broken increment', async () => {
    // C2 fix: reads go through tx.callLog.findFirst now
    prisma.__tx.callLog.findFirst.mockResolvedValue(null);

    await service.createPromise({
      contractId: 'c-1',
      userId: 'u-1',
      slots: [{ settlementDate: new Date('2099-05-05'), settlementAmount: 1000 }],
      targetInstallmentIds: ['i-1'],
      notes: 'x',
    });

    const createCall = prisma.__tx.callLog.create.mock.calls[0][0];
    expect(createCall.data.rescheduleCount).toBe(0);
    // C4 fix: callerId + calledAt must be present (no userId, no missing calledAt)
    expect(createCall.data.callerId).toBe('u-1');
    expect(createCall.data.calledAt).toBeInstanceOf(Date);
    expect(createCall.data.userId).toBeUndefined();
    // No BROKEN_PROMISE audit log written for "first promise" path
    expect(prisma.__tx.auditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'BROKEN_PROMISE' }) }),
    );
  });

  it('reschedule before due (1st time) — supersede old, no broken count', async () => {
    // C2 fix: reads go through tx.callLog.findFirst now
    prisma.__tx.callLog.findFirst.mockResolvedValue({
      id: 'old-cl',
      contractId: 'c-1',
      cycleStartedAt: new Date('2026-04-01'),
      cycleDeadline: new Date('2099-12-31'),
      rescheduleCount: 0,
      slots: [{ settlementDate: new Date('2099-05-10') }], // future
    });

    await service.createPromise({
      contractId: 'c-1',
      userId: 'u-1',
      slots: [{ settlementDate: new Date('2099-05-15'), settlementAmount: 1000 }],
      targetInstallmentIds: ['i-1'],
    });

    const updateCall = prisma.__tx.callLog.update.mock.calls.find(
      (c: any) => c[0].where.id === 'old-cl',
    );
    expect(updateCall[0].data.supersededAt).toBeInstanceOf(Date);
    expect(updateCall[0].data.brokenAt).toBeUndefined();
    expect(prisma.__tx.auditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'BROKEN_PROMISE' }) }),
    );
  });

  it('reschedule before due (2nd time) — supersede + BROKEN_PROMISE audit', async () => {
    // C2 fix: reads go through tx.callLog.findFirst now
    prisma.__tx.callLog.findFirst.mockResolvedValue({
      id: 'old-cl',
      contractId: 'c-1',
      cycleStartedAt: new Date('2026-04-01'),
      cycleDeadline: new Date('2099-12-31'),
      rescheduleCount: 1, // already rescheduled once
      slots: [{ settlementDate: new Date('2099-05-10') }], // future
    });

    await service.createPromise({
      contractId: 'c-1',
      userId: 'u-1',
      slots: [{ settlementDate: new Date('2099-05-15'), settlementAmount: 1000 }],
      targetInstallmentIds: ['i-1'],
    });

    const updateCall = prisma.__tx.callLog.update.mock.calls.find(
      (c: any) => c[0].where.id === 'old-cl',
    );
    expect(updateCall[0].data.brokenAt).toBeInstanceOf(Date);
    expect(prisma.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BROKEN_PROMISE',
          entity: 'contract',
          entityId: 'c-1',
        }),
      }),
    );
  });

  it('reschedule after due (any time) — supersede + BROKEN_PROMISE audit', async () => {
    // C2 fix: reads go through tx.callLog.findFirst now
    prisma.__tx.callLog.findFirst.mockResolvedValue({
      id: 'old-cl',
      contractId: 'c-1',
      cycleStartedAt: new Date('2026-04-01'),
      cycleDeadline: new Date('2099-12-31'),
      rescheduleCount: 0, // first reschedule but past due
      slots: [{ settlementDate: new Date('2026-04-10') }], // PAST
    });

    await service.createPromise({
      contractId: 'c-1',
      userId: 'u-1',
      slots: [{ settlementDate: new Date('2099-05-05'), settlementAmount: 1000 }],
      targetInstallmentIds: ['i-1'],
    });

    expect(prisma.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'BROKEN_PROMISE' }),
      }),
    );
  });

  it('rejects slot.settlementDate > cycleDeadline', async () => {
    // C2 fix: reads go through tx.callLog.findFirst now
    prisma.__tx.callLog.findFirst.mockResolvedValue({
      id: 'old-cl',
      cycleDeadline: new Date('2026-05-31'),
      rescheduleCount: 0,
      slots: [{ settlementDate: new Date('2099-05-10') }],
    });

    await expect(
      service.createPromise({
        contractId: 'c-1',
        userId: 'u-1',
        slots: [{ settlementDate: new Date('2099-06-15'), settlementAmount: 1000 }], // beyond deadline
        targetInstallmentIds: ['i-1'],
      }),
    ).rejects.toThrow(/cycleDeadline|เพดาน/);
  });
});

describe('PromiseService.findActivePromise', () => {
  let service: PromiseService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { callLog: { findFirst: jest.fn() }, payment: { findMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [PromiseService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(PromiseService);
  });

  it('queries with the canonical active filter', async () => {
    prisma.callLog.findFirst.mockResolvedValue(null);
    await service.findActivePromise('contract-1');

    const where = prisma.callLog.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      contractId: 'contract-1',
      result: 'PROMISED',
      brokenAt: null,
      supersededAt: null,
      keptAt: null,
      canceledAt: null,
    });
  });

  it('includes slots ordered by slotIndex', async () => {
    prisma.callLog.findFirst.mockResolvedValue(null);
    await service.findActivePromise('contract-1');

    const args = prisma.callLog.findFirst.mock.calls[0][0];
    expect(args.include.slots).toMatchObject({
      orderBy: { slotIndex: 'asc' },
    });
  });
});
