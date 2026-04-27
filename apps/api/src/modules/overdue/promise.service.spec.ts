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
