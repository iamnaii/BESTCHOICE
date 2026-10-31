import { ServiceUnavailableException } from '@nestjs/common';
import { FacebookCommentIngestService } from './facebook-comment-ingest.service';
import {
  classifyCommentIngestFailure,
  FacebookCommentIngestSkipped,
} from './facebook-comment-ingest-failure';
import type { PrismaService } from '../../prisma/prisma.service';
import type { IntegrationConfigService } from '../integrations/integration-config.service';
import type { FacebookCommentClient } from './facebook-comment-client';

/**
 * Task 35 (owner 2026-10-31, option 4): every way ingest() can fail, sorted into PERMANENT
 * (FacebookCommentIngestSkipped — the webhook keeps processing Messenger) or TRANSIENT (anything
 * else — 5xx, Meta redelivers). Unsure causes stay TRANSIENT.
 */
describe('FacebookCommentIngestService — which failures redelivery can fix', () => {
  const persisted = {
    threadId: 't1',
    commentId: '123_1_9',
    revision: 1,
    reconcile: false,
    replayed: false,
  };
  let prisma: {
    systemConfig: { findFirst: jest.Mock };
    facebookCommentPage: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let config: { getConfig: jest.Mock };
  let client: { getCapabilities: jest.Mock; revisionOf: jest.Mock; readComment: jest.Mock };
  let service: FacebookCommentIngestService;
  const valid = {
    item: 'comment',
    verb: 'add',
    post_id: '123_1',
    comment_id: '123_1_9',
    parent_id: '123_1',
    message: 'ข้อความ',
    from: { id: 'author-1' },
  };
  const entry = (...values: Record<string, unknown>[]) => ({
    id: '123',
    time: 1791255600,
    changes: values.map((value) => ({ field: 'feed', value })),
  });
  const failureOf = async (raw: unknown) => {
    const error = await service.ingest(raw).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeDefined();
    return { error, failure: classifyCommentIngestFailure(error) };
  };
  beforeEach(() => {
    prisma = {
      systemConfig: { findFirst: jest.fn().mockResolvedValue({ value: 'true' }) },
      facebookCommentPage: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ pageId: '123', enabled: true, company: 'SHOP', branchId: 'b1' }),
      },
      $transaction: jest.fn().mockResolvedValue(persisted),
    };
    config = { getConfig: jest.fn().mockResolvedValue({ pageId: '123' }) };
    client = {
      getCapabilities: jest.fn().mockResolvedValue({ receive: true, reason: null }),
      revisionOf: jest.fn().mockReturnValue(null),
      readComment: jest.fn(),
    };
    service = new FacebookCommentIngestService(
      prisma as unknown as PrismaService,
      config as unknown as IntegrationConfigService,
      client as unknown as FacebookCommentClient,
    );
  });

  describe('PERMANENT', () => {
    it.each([
      ['CONFIG', 'COMMENT_CONFIG_INCOMPLETE'],
      ['META_PERMISSION', 'COMMENT_META_NOT_READY'],
    ])('capability proven not ready (%s) → %s for every comment change', async (notReady, code) => {
      client.getCapabilities.mockResolvedValue({
        receive: false,
        reason: 'ตั้งค่า Page ID, App ID, Page Access Token และ App Secret ให้ครบ',
        notReady,
      });
      const { error, failure } = await failureOf(entry(valid, { ...valid, comment_id: '123_1_8' }));
      expect(error).toBeInstanceOf(FacebookCommentIngestSkipped);
      expect(failure).toEqual({ retry: false, reasonCode: code, skippedChanges: 2 });
      expect((error as Error).message).toBe(
        'ตั้งค่า Page ID, App ID, Page Access Token และ App Secret ให้ครบ',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['no comment_id', { comment_id: undefined }],
      ['no post_id', { post_id: undefined }],
      ['unknown verb', { verb: 'hide' }],
      ['comment_id too long', { comment_id: 'x'.repeat(257) }],
    ])('malformed change (%s) → COMMENT_EVENT_MALFORMED before any write', async (_l, patch) => {
      const { failure } = await failureOf(entry({ ...valid, ...patch }));
      expect(failure).toEqual({
        retry: false,
        reasonCode: 'COMMENT_EVENT_MALFORMED',
        skippedChanges: 1,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a malformed change does not drop the valid changes of the same entry', async () => {
      const { failure } = await failureOf(
        entry({ ...valid, verb: 'hide' }, valid, { ...valid, comment_id: undefined }),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(failure).toEqual({
        retry: false,
        reasonCode: 'COMMENT_EVENT_MALFORMED',
        skippedChanges: 2,
      });
    });

    it('change whose stored thread belongs to another post → COMMENT_POST_MISMATCH (rolled back)', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        facebookCommentPage: { findUnique: jest.fn().mockResolvedValue({ enabled: true }) },
        facebookCommentRecord: { findUnique: jest.fn().mockResolvedValue(null) },
        facebookCommentEvent: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
        facebookCommentThread: {
          upsert: jest.fn().mockResolvedValue({ id: 't1', postId: '123_OTHER' }),
        },
      };
      prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
      const { failure } = await failureOf(entry(valid));
      expect(failure).toEqual({
        retry: false,
        reasonCode: 'COMMENT_POST_MISMATCH',
        skippedChanges: 1,
      });
      expect(tx.facebookCommentEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('TRANSIENT (Meta redelivers; Messenger in the request waits as before)', () => {
    it('capability not ready without proof (Graph outage / unknown) → the 503 it always was', async () => {
      client.getCapabilities.mockResolvedValue({
        receive: false,
        reason: 'ตรวจสิทธิ์กับ Meta ไม่สำเร็จ กรุณาลองตรวจอีกครั้ง',
      });
      const { error, failure } = await failureOf(entry(valid));
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(failure).toEqual({ retry: true });
    });

    it.each([
      ['feature flag read', () => prisma.systemConfig.findFirst.mockRejectedValue(new Error('db'))],
      ['configuration read', () => config.getConfig.mockRejectedValue(new Error('db'))],
      [
        'Page binding read',
        () => prisma.facebookCommentPage.findUnique.mockRejectedValue(new Error('db')),
      ],
      ['persistence transaction', () => prisma.$transaction.mockRejectedValue(new Error('P2028'))],
    ])('database failure at %s', async (_l, arrange) => {
      arrange();
      expect((await failureOf(entry(valid))).failure).toEqual({ retry: true });
    });

    it('Page disabled between the outer check and the locked row → retried (redelivery re-checks)', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        facebookCommentPage: { findUnique: jest.fn().mockResolvedValue({ enabled: false }) },
      };
      prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
      const { error, failure } = await failureOf(entry(valid));
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(failure).toEqual({ retry: true });
    });

    it('a transient failure after a malformed change wins — the request is redelivered', async () => {
      prisma.$transaction.mockRejectedValue(new Error('database unavailable'));
      const { error, failure } = await failureOf(entry({ ...valid, verb: 'hide' }, valid));
      expect(failure).toEqual({ retry: true });
      expect((error as Error).message).toBe('database unavailable');
    });

    it('reconcile after a committed change fails → retried (redelivery replays the read only)', async () => {
      prisma.$transaction.mockResolvedValue({ ...persisted, reconcile: true });
      jest.spyOn(service, 'reconcile').mockRejectedValue(new Error('db'));
      expect((await failureOf(entry(valid))).failure).toEqual({ retry: true });
    });
  });

  it('nothing to skip → the result is unchanged', async () => {
    await expect(service.ingest(entry(valid))).resolves.toEqual({ persisted: 1, ignored: 0 });
  });
});
