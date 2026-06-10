import { ReconcileController } from './reconcile.controller';
import { OutboxService } from './outbox.service';

/**
 * #6c — the OWNER-facing outbox recovery dashboard had zero coverage. retry()
 * is a state-mutating recovery action on the cross-entity money saga, so it
 * should at least have a smoke test that pins what it delegates to. The
 * controller is instantiated directly (guards are request-time concerns, not
 * under test here).
 */
describe('ReconcileController', () => {
  let controller: ReconcileController;
  let outbox: { findFailed: jest.Mock; retry: jest.Mock };

  beforeEach(() => {
    outbox = {
      findFailed: jest.fn().mockResolvedValue([{ id: 'e1', status: 'FAILED' }]),
      retry: jest.fn().mockResolvedValue({ id: 'e1', status: 'PENDING', attempts: 0 }),
    };
    controller = new ReconcileController(outbox as unknown as OutboxService);
  });

  it('GET failed → delegates to OutboxService.findFailed', async () => {
    const res = await controller.listFailed();
    expect(outbox.findFailed).toHaveBeenCalledTimes(1);
    expect(res).toEqual([{ id: 'e1', status: 'FAILED' }]);
  });

  it('POST :id/retry → delegates to OutboxService.retry with the id (resets to PENDING/attempts 0)', async () => {
    const res = await controller.retry('e1');
    expect(outbox.retry).toHaveBeenCalledWith('e1');
    expect(res).toMatchObject({ status: 'PENDING', attempts: 0 });
  });
});
