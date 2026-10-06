import { Injectable, NotFoundException } from '@nestjs/common';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { FacebookCommentIngestService } from '../../chat-adapters/facebook-comment-ingest.service';
import { FacebookCommentWorkService } from './facebook-comment-work.service';

@Injectable()
export class FacebookCommentRefreshService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly work: FacebookCommentWorkService,
    private readonly ingest: FacebookCommentIngestService,
  ) {}
  async refreshRoot(id: string, actor: ChatWorkActor, scope: WorkScope) {
    const { thread } = await this.work.assertThread(id, actor, scope);
    const refreshed = await this.ingest.reconcile(id, thread.rootCommentId, thread.revision, (tx) =>
      this.work.assertThread(id, actor, scope, tx),
    );
    return { refreshed };
  }

  /** One selected record per request bounds provider work, including on large threads. */
  async refresh(id: string, recordId: string, actor: ChatWorkActor, scope: WorkScope) {
    const { thread } = await this.work.assertThread(id, actor, scope);
    const record = await this.prisma.facebookCommentRecord.findFirst({
      where: { id: recordId, threadId: id },
    });
    if (!record) throw new NotFoundException('ไม่พบคอมเมนต์ในกระทู้นี้');
    // Read outside the transaction; CAS and current permissions are checked again before applying.
    const refreshed = await this.ingest.reconcile(id, record.commentId, thread.revision, (tx) =>
      this.work.assertThread(id, actor, scope, tx),
    );
    return { refreshed };
  }
}
