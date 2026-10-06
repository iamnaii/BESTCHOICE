/** Synthetic comment provider, available only in the disposable preview runner. */
import { BadRequestException, Body, Controller, Logger, Post } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../../src/prisma/prisma.service';
import { IntegrationConfigService } from '../../src/modules/integrations/integration-config.service';
import {
  FacebookCommentClient,
  type FacebookCommentReplyProof,
  type FacebookCommentTransport,
} from '../../src/modules/chat-adapters/facebook-comment-client';
import { FacebookCommentIngestService } from '../../src/modules/chat-adapters/facebook-comment-ingest.service';
import { FacebookWebhookController } from '../../src/modules/chat-adapters/facebook-webhook.controller';
export async function previewFacebookComments(db: PrismaService, actorId: string) {
  const pageId = 'preview-bestchoice-page';
  const secret = 'synthetic-only-not-a-meta-secret';
  const config = {
    getConfig: async () => ({ pageId, pageAccessToken: 'synthetic-token', appSecret: secret }),
  } as unknown as IntegrationConfigService;
  const proofs = new Map<string, FacebookCommentReplyProof>();
  let mode: 'confirmed' | 'timeout' | 'disabled' | 'failed' = 'confirmed';
  let dispatchCount = 0;
  const transport: FacebookCommentTransport = {
    readRevision: (value) =>
      typeof value.previewRevision === 'string' ? value.previewRevision : null,
    evidence: async () => ({
      graphVersion: 'synthetic-v1',
      verified: mode !== 'disabled',
      receive: true,
      publicReply: true,
      privateReply: false,
    }),
    readComment: async () => null,
    readReply: async (_page, id) => proofs.get(id) ?? null,
    replyPublic: async (input) => {
      dispatchCount++;
      if (mode === 'failed') return { definitelyNotSent: true, errorCode: 'PERMISSION_DENIED' };
      const externalId = `preview-reply-${randomUUID()}`;
      proofs.set(externalId, {
        pageId,
        externalId,
        parentCommentId: input.commentId,
        authorId: pageId,
        text: input.text,
        createdAt: new Date().toISOString(),
      });
      if (mode === 'timeout') throw new Error('Synthetic timeout after provider accepted');
      return { externalId };
    },
  };
  const client = new FacebookCommentClient(config, transport);
  const ingest = new FacebookCommentIngestService(db, config, client);
  // Invoke the real signed-webhook handler. Only comment fixtures are accepted here;
  // no Messenger adapter or network transport exists in this fixture.
  const webhook = Object.assign(Object.create(FacebookWebhookController.prototype), {
    logger: new Logger('PreviewFacebookWebhook'),
    prisma: db,
    integrationConfig: config,
    anomaly: { record: async () => undefined },
    comments: ingest,
  }) as FacebookWebhookController;
  const binding = await db.facebookCommentPage.findUnique({ where: { pageId } });
  const branch = binding
    ? { id: binding.branchId }
    : await db.branch.create({ data: { name: 'สาขาคอมเมนต์จำลอง' } });
  await db.facebookCommentPage.upsert({
    where: { pageId },
    create: { pageId, branchId: branch.id, company: 'SHOP', enabled: true },
    update: { enabled: true },
  });
  await db.systemConfig.upsert({
    where: { key: 'chat_facebook_comments_enabled' },
    create: { key: 'chat_facebook_comments_enabled', value: 'true' },
    update: { value: 'true', deletedAt: null },
  });
  @Controller('preview/facebook-comments')
  class PreviewFacebookCommentsController {
    @Post('mode') setMode(@Body() input: { mode: string }) {
      if (!['confirmed', 'timeout', 'disabled', 'failed'].includes(input.mode))
        throw new BadRequestException('Unknown synthetic mode');
      mode = input.mode as typeof mode;
      return { mode, dispatchCount };
    }
    @Post('fixture') async fixture(
      @Body()
      input: {
        invalidSignature?: boolean;
        commentId?: string;
        text?: string;
        revision?: string;
        remove?: boolean;
      },
    ) {
      if (mode === 'disabled') mode = 'confirmed';
      const commentId = input.commentId || `preview-comment-${randomUUID()}`;
      const body = {
        object: 'page',
        entry: [
          {
            id: pageId,
            time: Math.floor(Date.now() / 1000),
            changes: [
              {
                field: 'feed',
                value: {
                  item: 'comment',
                  verb: input.remove ? 'remove' : input.commentId ? 'edited' : 'add',
                  comment_id: commentId,
                  post_id: 'preview-post',
                  parent_id: 'preview-post',
                  message: input.text || 'สนใจสินค้าค่ะ มีสีอะไรบ้าง',
                  from: { id: 'synthetic-comment-author', name: 'ลูกค้าคอมเมนต์จำลอง' },
                  previewRevision: input.revision || '1',
                },
              },
            ],
          },
        ],
      };
      const rawBody = Buffer.from(JSON.stringify(body));
      const signature = input.invalidSignature
        ? 'sha256=invalid'
        : `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
      await webhook.handleWebhook(
        { rawBody, headers: {}, ip: '127.0.0.1' } as unknown as Request,
        body,
        signature,
      );
      const thread = await db.facebookCommentThread.findUniqueOrThrow({
        where: { pageId_rootCommentId: { pageId, rootCommentId: commentId } },
      });
      // Assignment uses the real API in browser acceptance; fixture ownership starts unassigned.
      return { id: thread.id, commentId, actorId, signed: true };
    }
    @Post('proof') proof(@Body() input: { threadId: string }) {
      return db.facebookCommentThread
        .findUniqueOrThrow({ where: { id: input.threadId } })
        .then((thread) => ({
          proof: [...proofs.values()].findLast((p) => p.parentCommentId === thread.rootCommentId),
          dispatchCount,
        }));
    }
    @Post('echo') async echo(@Body() input: { externalId: string }) {
      const proof = proofs.get(input.externalId);
      if (!proof) throw new BadRequestException('No synthetic proof');
      await ingest.ingest({
        id: pageId,
        changes: [
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              post_id: 'preview-post',
              comment_id: proof.externalId,
              parent_id: proof.parentCommentId,
              from: { id: pageId, name: 'BESTCHOICE จำลอง' },
              message: proof.text,
              previewRevision: '1',
            },
          },
        ],
      });
      return { ok: true };
    }
  }
  return { client, controller: PreviewFacebookCommentsController };
}
