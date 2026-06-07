import { OutboxProcessorService } from './outbox-processor.service';

describe('OutboxProcessorService.processOutbox', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let outboxMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaFinMock: any;
  let svc: OutboxProcessorService;

  beforeEach(() => {
    outboxMock = {
      findPending: jest.fn(),
      claimPending: jest.fn(),
      markProcessed: jest.fn(),
      markFailed: jest.fn(),
    };
    prismaFinMock = {};
    svc = new OutboxProcessorService(outboxMock, prismaFinMock);
  });

  it('processes pending events successfully (stub flow)', async () => {
    outboxMock.findPending.mockResolvedValue([
      { id: 'e1', flowType: 'CONTRACT_ACTIVATION', payload: {}, attempts: 0, idempotencyKey: 'k1' },
      { id: 'e2', flowType: 'PAYMENT_RECEIPT', payload: {}, attempts: 0, idempotencyKey: 'k2' },
    ]);
    outboxMock.claimPending.mockResolvedValue({ claimed: true, attempts: 1 });
    outboxMock.markProcessed.mockResolvedValue({});

    const result = await svc.processOutbox(10);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(outboxMock.markProcessed).toHaveBeenCalledTimes(2);
  });

  it('skips an event whose atomic claim was lost to another worker (no double-process)', async () => {
    outboxMock.findPending.mockResolvedValue([
      { id: 'e1', flowType: 'CONTRACT_ACTIVATION', payload: {}, attempts: 0, idempotencyKey: 'k1' },
    ]);
    // Another tick/pod already claimed it → count 0 → claimed:false.
    outboxMock.claimPending.mockResolvedValue({ claimed: false, attempts: 0 });

    const result = await svc.processOutbox(10);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(outboxMock.markProcessed).not.toHaveBeenCalled();
    expect(outboxMock.markFailed).not.toHaveBeenCalled();
  });

  it('marks event PENDING for retry on transient failure, using the DB attempts (not the stale in-memory value)', async () => {
    // In-memory event.attempts=4 would compute isFinal via the OLD `event.attempts+1=5` path.
    // The DB-persisted post-claim attempts is 2 → finality must be driven off THAT (not final).
    outboxMock.findPending.mockResolvedValue([
      { id: 'e1', flowType: 'CONTRACT_ACTIVATION', payload: {}, attempts: 4, idempotencyKey: 'k1' },
    ]);
    outboxMock.claimPending.mockResolvedValue({ claimed: true, attempts: 2 });
    jest.spyOn(svc as never, 'writeFinanceJournal').mockRejectedValue(new Error('transient') as never);

    const result = await svc.processOutbox(10);
    expect(result.failed).toBe(1);
    expect(outboxMock.markFailed).toHaveBeenCalledWith('e1', 'transient', false);
  });

  it('marks event FAILED on final failure when DB attempts reaches the limit', async () => {
    outboxMock.findPending.mockResolvedValue([
      { id: 'e1', flowType: 'CONTRACT_ACTIVATION', payload: {}, attempts: 0, idempotencyKey: 'k1' },
    ]);
    outboxMock.claimPending.mockResolvedValue({ claimed: true, attempts: 5 });
    jest.spyOn(svc as never, 'writeFinanceJournal').mockRejectedValue(new Error('permanent') as never);

    const result = await svc.processOutbox(10);
    expect(result.failed).toBe(1);
    expect(outboxMock.markFailed).toHaveBeenCalledWith('e1', 'permanent', true);
  });

  it('counts a claim DB error as a transient failure and does not process the row', async () => {
    outboxMock.findPending.mockResolvedValue([
      { id: 'e1', flowType: 'CONTRACT_ACTIVATION', payload: {}, attempts: 0, idempotencyKey: 'k1' },
    ]);
    outboxMock.claimPending.mockRejectedValue(new Error('DB down'));

    const result = await svc.processOutbox(10);
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(outboxMock.markProcessed).not.toHaveBeenCalled();
    expect(outboxMock.markFailed).not.toHaveBeenCalled();
  });
});
