import { OutboxService } from './outbox.service';
import { Prisma } from '@prisma/client';

describe('OutboxService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  let svc: OutboxService;

  beforeEach(() => {
    prismaMock = {
      outboxEvent: {
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    svc = new OutboxService(prismaMock);
  });

  it('enqueue creates event with PENDING status', async () => {
    prismaMock.outboxEvent.create.mockResolvedValue({ id: 'e1', status: 'PENDING' });
    const event = await svc.enqueue({
      flowType: 'CONTRACT_ACTIVATION',
      sourceId: 'c1',
      sourceEntity: 'SHOP',
      targetEntity: 'FINANCE',
      payload: { amount: 1000 },
      idempotencyKey: 'CONTRACT_ACTIVATION-c1',
    });
    expect(event.status).toBe('PENDING');
    expect(prismaMock.outboxEvent.create).toHaveBeenCalled();
  });

  it('enqueue idempotent — duplicate key returns existing', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '6.x',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    prismaMock.outboxEvent.create.mockRejectedValue(conflict);
    prismaMock.outboxEvent.findUniqueOrThrow.mockResolvedValue({
      id: 'existing',
      status: 'PENDING',
    });

    const event = await svc.enqueue({
      flowType: 'CONTRACT_ACTIVATION',
      sourceId: 'c1',
      sourceEntity: 'SHOP',
      targetEntity: 'FINANCE',
      payload: {},
      idempotencyKey: 'CONTRACT_ACTIVATION-c1',
    });
    expect(event.id).toBe('existing');
  });

  it('findPending returns events under attempt limit', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'e1' }]);
    const events = await svc.findPending(10);
    expect(prismaMock.outboxEvent.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', deletedAt: null, attempts: { lt: 5 } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    expect(events).toHaveLength(1);
  });

  it('claimPending wins the row with a status=PENDING guard and returns DB attempts', async () => {
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.outboxEvent.findUnique.mockResolvedValue({ attempts: 3 });

    const res = await svc.claimPending('e1');
    expect(res).toEqual({ claimed: true, attempts: 3 });
    expect(prismaMock.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', status: 'PENDING', deletedAt: null },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
  });

  it('claimPending loses (claimed=false) when another worker already claimed the row', async () => {
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 0 });

    const res = await svc.claimPending('e1');
    expect(res).toEqual({ claimed: false, attempts: 0 });
    // No re-read when the claim was lost.
    expect(prismaMock.outboxEvent.findUnique).not.toHaveBeenCalled();
  });

  it('markFailed with isFinal=true sets status FAILED', async () => {
    prismaMock.outboxEvent.update.mockResolvedValue({});
    await svc.markFailed('e1', 'fin DB down', true);
    expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: 'FAILED', lastError: 'fin DB down' },
    });
  });

  it('markFailed with isFinal=false keeps PENDING (for retry)', async () => {
    prismaMock.outboxEvent.update.mockResolvedValue({});
    await svc.markFailed('e1', 'transient', false);
    expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: 'PENDING', lastError: 'transient' },
    });
  });
});
