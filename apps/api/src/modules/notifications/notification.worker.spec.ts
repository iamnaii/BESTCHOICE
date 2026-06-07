import { BadRequestException } from '@nestjs/common';
import { NotificationWorker } from './notification.worker';

/**
 * Wave-1 #1 — the LINE and EMAIL branches used to only log() and return
 * {success:true}, so every overdue dunning notice (enqueueOverdueNotice →
 * type 'LINE') was silently dropped with no retry/alert. These tests pin that
 * LINE now actually dispatches and EMAIL fails loudly instead of faking success.
 */
describe('NotificationWorker.process — channel dispatch (Wave-1 #1)', () => {
  let worker: NotificationWorker;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notificationsService: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeJob = (data: any): any => ({ data, id: 'job-1', attemptsMade: 0, opts: { attempts: 3 } });

  beforeEach(() => {
    notificationsService = {
      sendSmsFromQueue: jest.fn().mockResolvedValue('sms-id'),
      sendLineFromQueue: jest.fn().mockResolvedValue(undefined),
    };
    worker = new NotificationWorker(notificationsService);
  });

  it('LINE job actually pushes via sendLineFromQueue on the finance OA (not a no-op log)', async () => {
    const res = await worker.process(
      makeJob({ type: 'LINE', recipientLineId: 'U123', templateKey: 'overdue_notice', variables: { _message: 'ค้างชำระ' } }),
    );

    expect(notificationsService.sendLineFromQueue).toHaveBeenCalledWith('U123', 'ค้างชำระ', 'line-finance');
    expect(res).toEqual({ success: true, channel: 'LINE' });
  });

  it('LINE job with a failing push throws (→ BullMQ retry), never reports success', async () => {
    notificationsService.sendLineFromQueue.mockRejectedValue(new Error('LINE API 500'));

    await expect(
      worker.process(makeJob({ type: 'LINE', recipientLineId: 'U123', templateKey: 'overdue_notice', variables: {} })),
    ).rejects.toThrow('LINE API 500');
  });

  it('LINE without recipientLineId throws (no silent success)', async () => {
    await expect(
      worker.process(makeJob({ type: 'LINE', templateKey: 'overdue_notice', variables: {} })),
    ).rejects.toThrow(BadRequestException);
  });

  it('EMAIL job throws not-implemented instead of faking success', async () => {
    await expect(
      worker.process(makeJob({ type: 'EMAIL', recipientEmail: 'x@y.com', templateKey: 'overdue_notice', variables: {} })),
    ).rejects.toThrow(/not implemented/);
  });

  it('SMS job still dispatches (regression)', async () => {
    await worker.process(
      makeJob({ type: 'SMS', recipientPhone: '0812345678', templateKey: 'payment_reminder', variables: {} }),
    );

    expect(notificationsService.sendSmsFromQueue).toHaveBeenCalled();
  });
});
