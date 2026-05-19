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
      markProcessing: jest.fn(),
      markProcessed: jest.fn(),
      markFailed: jest.fn(),
    };
    prismaFinMock = {};
    svc = new OutboxProcessorService(outboxMock, prismaFinMock);
  });

  it('processes pending events successfully (stub flow)', async () => {
    outboxMock.findPending.mockResolvedValue([
      {
        id: 'e1',
        flowType: 'CONTRACT_ACTIVATION',
        payload: {},
        attempts: 0,
        idempotencyKey: 'k1',
      },
      {
        id: 'e2',
        flowType: 'PAYMENT_RECEIPT',
        payload: {},
        attempts: 0,
        idempotencyKey: 'k2',
      },
    ]);
    outboxMock.markProcessing.mockResolvedValue({});
    outboxMock.markProcessed.mockResolvedValue({});

    const result = await svc.processOutbox(10);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(outboxMock.markProcessed).toHaveBeenCalledTimes(2);
  });

  it('marks event PENDING for retry on transient failure (attempts < 5)', async () => {
    outboxMock.findPending.mockResolvedValue([
      {
        id: 'e1',
        flowType: 'CONTRACT_ACTIVATION',
        payload: {},
        attempts: 2,
        idempotencyKey: 'k1',
      },
    ]);
    outboxMock.markProcessing.mockRejectedValue(new Error('transient'));

    const result = await svc.processOutbox(10);
    expect(result.failed).toBe(1);
    expect(outboxMock.markFailed).toHaveBeenCalledWith('e1', 'transient', false);
  });

  it('marks event FAILED on final failure (attempts >= 5)', async () => {
    outboxMock.findPending.mockResolvedValue([
      {
        id: 'e1',
        flowType: 'CONTRACT_ACTIVATION',
        payload: {},
        attempts: 4,
        idempotencyKey: 'k1',
      },
    ]);
    outboxMock.markProcessing.mockRejectedValue(new Error('permanent'));

    const result = await svc.processOutbox(10);
    expect(result.failed).toBe(1);
    expect(outboxMock.markFailed).toHaveBeenCalledWith('e1', 'permanent', true);
  });
});
