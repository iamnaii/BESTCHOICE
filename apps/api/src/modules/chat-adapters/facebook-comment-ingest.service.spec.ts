import { createHmac } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { FacebookCommentIngestService } from './facebook-comment-ingest.service';
describe('Signed comment events share the existing webhook without losing Messenger events', () => {
  const secret = 'synthetic-app-secret';
  const ingest = { ingest: jest.fn() };
  const controller = new FacebookWebhookController(
    {} as any,
    {} as any,
    { record: jest.fn().mockResolvedValue(null) } as any,
    {} as any,
    {} as any,
    { getConfig: async () => ({ appSecret: secret }) } as any,
    undefined,
    ingest as unknown as FacebookCommentIngestService,
  );
  const messaging = jest
    .spyOn(controller as any, 'processMessagingEvent')
    .mockResolvedValue(undefined);
  const body = {
    object: 'page',
    entry: [
      {
        id: 'page',
        messaging: [{ message: { mid: 'message' } }],
        changes: [{ field: 'feed', value: { item: 'comment' } }],
      },
    ],
  };
  const request = () => {
    const rawBody = Buffer.from(JSON.stringify(body));
    return {
      req: { rawBody, headers: {} } as any,
      signature: 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'),
    };
  };
  beforeEach(() => {
    ingest.ingest.mockReset().mockResolvedValue({ persisted: 1 });
    messaging.mockClear();
  });
  it('persists comment changes and processes messaging in the same signed entry', async () => {
    const { req, signature } = request();
    expect(await controller.handleWebhook(req, body, signature)).toBe('EVENT_RECEIVED');
    expect(ingest.ingest).toHaveBeenCalledWith(body.entry[0]);
    expect(messaging).toHaveBeenCalledTimes(1);
  });
  it('does not acknowledge or dispatch Messenger until comment persistence is complete', async () => {
    let resolve!: (result: unknown) => void;
    ingest.ingest.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { req, signature } = request();
    const pending = controller.handleWebhook(req, body, signature);
    await new Promise((r) => setImmediate(r));
    expect(messaging).not.toHaveBeenCalled();
    resolve({ persisted: 1 });
    await pending;
    expect(messaging).toHaveBeenCalledTimes(1);
  });
  it('returns a retryable failure before any Messenger side effect when comment persistence fails', async () => {
    ingest.ingest.mockRejectedValue(new Error('database unavailable'));
    const { req, signature } = request();
    await expect(controller.handleWebhook(req, body, signature)).rejects.toThrow(
      'database unavailable',
    );
    expect(messaging).not.toHaveBeenCalled();
  });
  it('HMAC failure never reaches either ingestion path', async () => {
    const { req } = request();
    await expect(controller.handleWebhook(req, body, 'sha256=wrong')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(messaging).not.toHaveBeenCalled();
  });
});
