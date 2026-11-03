import { WebhookDedupService } from './webhook-dedup.service';

/**
 * `claim()` (Task 37 — Facebook Messenger) tells a duplicate apart from a database failure;
 * `isDuplicate()` keeps LINE's existing fail-closed meaning (any failure = treat as processed).
 */
describe('WebhookDedupService', () => {
  const create = jest.fn();
  const service = new WebhookDedupService({ processedWebhookEvent: { create } } as never);
  const unique = Object.assign(new Error('Unique constraint failed on the fields: (`event_id`)'), {
    code: 'P2002',
  });

  beforeEach(() => create.mockReset());

  it('claim: first insert → claimed', async () => {
    create.mockResolvedValue({ id: 'row' });
    await expect(service.claim('fb:postback:abc')).resolves.toBe('claimed');
    expect(create).toHaveBeenCalledWith({ data: { eventId: 'fb:postback:abc' } });
  });

  it('claim: unique violation → duplicate', async () => {
    create.mockRejectedValue(unique);
    await expect(service.claim('fb:postback:abc')).resolves.toBe('duplicate');
  });

  it('claim: any other failure is thrown — the caller decides', async () => {
    create.mockRejectedValue(new Error('connection pool timeout'));
    await expect(service.claim('fb:postback:abc')).rejects.toThrow('connection pool timeout');
  });

  it('isDuplicate (LINE) unchanged: new → false · unique violation → true · other failure → true', async () => {
    create.mockResolvedValueOnce({ id: 'row' });
    await expect(service.isDuplicate('line-1')).resolves.toBe(false);
    create.mockRejectedValueOnce(unique);
    await expect(service.isDuplicate('line-1')).resolves.toBe(true);
    create.mockRejectedValueOnce(new Error('connection pool timeout'));
    await expect(service.isDuplicate('line-2')).resolves.toBe(true);
  });
});
