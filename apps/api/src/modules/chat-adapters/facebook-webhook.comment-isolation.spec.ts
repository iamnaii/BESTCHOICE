import { createHmac } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { FacebookCommentIngestService } from './facebook-comment-ingest.service';
import { FacebookCommentIngestSkipped } from './facebook-comment-ingest-failure';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

/**
 * Task 35 (owner 2026-10-31, option 4): order unchanged (comments before Messenger). A comment
 * failure that redelivery cannot fix no longer holds the Messenger events of the same request;
 * a transient one still answers non-2xx before any Messenger side effect (behaviour pinned in
 * facebook-comment-ingest.service.spec.ts stays as it was).
 */
describe('FacebookWebhookController — permanent comment failures do not hold Messenger', () => {
  const secret = 'synthetic-app-secret';
  const ingest = { ingest: jest.fn() };
  const controller = new FacebookWebhookController(
    {} as any,
    {} as any,
    { record: jest.fn().mockResolvedValue(null) } as any,
    {} as any,
    {} as any,
    { getConfig: async () => ({ appSecret: secret }) } as any,
    { claim: jest.fn().mockResolvedValue('claimed') } as never,
    undefined,
    ingest as unknown as FacebookCommentIngestService,
  );
  const messaging = jest
    .spyOn(controller as any, 'processMessagingEvent')
    .mockResolvedValue(undefined);
  const commentChange = {
    field: 'feed',
    value: {
      item: 'comment',
      verb: 'add',
      message: 'ข้อความคอมเมนต์ลับของลูกค้า',
      from: { id: 'author-1', name: 'ชื่อลูกค้าลับ' },
    },
  };
  const entry = (id: string, mid: string) => ({
    id,
    time: 1791255600,
    messaging: [{ sender: { id: 'psid' }, message: { mid } }],
    changes: [commentChange],
  });
  const signed = (body: unknown) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    return {
      req: { rawBody, headers: {} } as any,
      signature: 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'),
    };
  };
  const skipped = (
    code:
      | 'COMMENT_CONFIG_INCOMPLETE'
      | 'COMMENT_EVENT_MALFORMED'
      | 'COMMENT_VERB_UNSUPPORTED' = 'COMMENT_CONFIG_INCOMPLETE',
  ) =>
    new FacebookCommentIngestSkipped(
      code,
      'ตั้งค่า Page ID, App ID, Page Access Token และ App Secret ให้ครบ',
      1,
    );
  beforeEach(() => {
    ingest.ingest.mockReset();
    messaging.mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it('permanent failure → Messenger in the same request is processed and the webhook answers 200', async () => {
    ingest.ingest.mockRejectedValue(skipped());
    const body = { object: 'page', entry: [entry('1234', 'mid-1')] };
    const { req, signature } = signed(body);
    await expect(controller.handleWebhook(req, body, signature)).resolves.toBe('EVENT_RECEIVED');
    expect(messaging).toHaveBeenCalledTimes(1);
    expect(messaging).toHaveBeenCalledWith(body.entry[0].messaging[0]);
  });

  it('reports the skip to Sentry with ids and a reason code only — no comment text or author', async () => {
    ingest.ingest.mockRejectedValue(skipped('COMMENT_EVENT_MALFORMED'));
    const body = { object: 'page', entry: [entry('1234', 'mid-1')] };
    const { req, signature } = signed(body);
    await controller.handleWebhook(req, body, signature);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, context] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(message).toBe('Facebook comment event skipped — not retryable');
    expect(context).toEqual({
      level: 'warning',
      tags: {
        subsystem: 'facebook-comments',
        action: 'comment-ingest-skipped',
        reason: 'COMMENT_EVENT_MALFORMED',
      },
      extra: { pageId: '1234', skippedChanges: 1 },
    });
    const sent = JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls);
    expect(sent).not.toContain('ข้อความคอมเมนต์ลับของลูกค้า');
    expect(sent).not.toContain('ชื่อลูกค้าลับ');
    expect(sent).not.toContain('author-1');
  });

  // Review round 3 M2: hide/unhide are expected — Messenger continues, info log, no Sentry.
  it('unsupported comment verb → Messenger processed, 200, logged at info and not alerted', async () => {
    const info = jest.spyOn((controller as any).logger, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => undefined);
    ingest.ingest.mockRejectedValue(skipped('COMMENT_VERB_UNSUPPORTED'));
    const body = { object: 'page', entry: [entry('1234', 'mid-1')] };
    const { req, signature } = signed(body);
    await expect(controller.handleWebhook(req, body, signature)).resolves.toBe('EVENT_RECEIVED');
    expect(messaging).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      '[FB Webhook] comment event skipped (COMMENT_VERB_UNSUPPORTED) page=1234 changes=1',
    );
    expect(warn).not.toHaveBeenCalled();
    info.mockRestore();
    warn.mockRestore();
  });

  it('transient failure → non-2xx and Messenger is not processed (unchanged)', async () => {
    ingest.ingest.mockRejectedValue(
      new ServiceUnavailableException('ตรวจสิทธิ์กับ Meta ไม่สำเร็จ'),
    );
    const body = { object: 'page', entry: [entry('1234', 'mid-1')] };
    const { req, signature } = signed(body);
    await expect(controller.handleWebhook(req, body, signature)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(messaging).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('one transient entry still holds the whole request even after a permanent skip', async () => {
    ingest.ingest
      .mockRejectedValueOnce(skipped())
      .mockRejectedValueOnce(new Error('database unavailable'));
    const body = { object: 'page', entry: [entry('1234', 'mid-1'), entry('1234', 'mid-2')] };
    const { req, signature } = signed(body);
    await expect(controller.handleWebhook(req, body, signature)).rejects.toThrow(
      'database unavailable',
    );
    expect(ingest.ingest).toHaveBeenCalledTimes(2);
    expect(messaging).not.toHaveBeenCalled();
  });

  it('every entry is still ingested before Messenger; permanent skips on several entries all continue', async () => {
    const order: string[] = [];
    ingest.ingest.mockImplementation(async (e: { messaging: { message: { mid: string } }[] }) => {
      order.push(`comment:${e.messaging[0].message.mid}`);
      throw skipped();
    });
    messaging.mockImplementation(async (event: { message: { mid: string } }) => {
      order.push(`messenger:${event.message.mid}`);
    });
    const body = { object: 'page', entry: [entry('1234', 'mid-1'), entry('1234', 'mid-2')] };
    const { req, signature } = signed(body);
    await expect(controller.handleWebhook(req, body, signature)).resolves.toBe('EVENT_RECEIVED');
    expect(order).toEqual(['comment:mid-1', 'comment:mid-2', 'messenger:mid-1', 'messenger:mid-2']);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    messaging.mockReset().mockResolvedValue(undefined);
  });
});
