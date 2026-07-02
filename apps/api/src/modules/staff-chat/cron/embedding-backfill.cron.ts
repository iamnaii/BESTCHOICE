import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmbeddingService } from '../services/embedding.service';

const EMBED_BATCH = 100;
// กัน runaway คืนแรกที่ backfill ของเก่าทั้งหมด — ทยอยจบเอง หรือยิง manual trigger ซ้ำได้
const NIGHTLY_CAP = 5000;

/**
 * WS3 — เติม embedding ให้ AiTrainingPair ที่ยังไม่มี (pairs จาก feedback/cron/import
 * ถูกสร้างแบบไม่มี embedding — semantic retrieval เลยมองไม่เห็นข้อมูลใหม่)
 * รัน 03:30 BKK หลัง training-extract (03:00) จบ
 */
@Injectable()
export class EmbeddingBackfillCron {
  private readonly logger = new Logger(EmbeddingBackfillCron.name);

  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
  ) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Bangkok' })
  async backfillEmbeddings(): Promise<{ embedded: number }> {
    if (!this.embedding.isReady()) {
      this.logger.warn('Embedding service not ready (GOOGLE_CLOUD_PROJECT unset) — skip backfill');
      return { embedded: 0 };
    }

    let embedded = 0;
    try {
      while (embedded < NIGHTLY_CAP) {
        const batchSize = Math.min(EMBED_BATCH, NIGHTLY_CAP - embedded);
        const rows = await this.prisma.$queryRaw<{ id: string; customer_message: string }[]>`
          SELECT id, customer_message
          FROM ai_training_pairs
          WHERE embedding IS NULL
          ORDER BY created_at ASC
          LIMIT ${batchSize}
        `;
        if (rows.length === 0) break;

        const vectors = await this.embedding.embedBatch(
          rows.map((r) => r.customer_message),
          'RETRIEVAL_DOCUMENT',
        );
        const model = this.embedding.getModel();

        for (let i = 0; i < rows.length; i++) {
          await this.prisma.$executeRaw`
            UPDATE ai_training_pairs
            SET embedding = ${this.embedding.toPgvector(vectors[i])}::vector,
                embedding_model = ${model},
                embedded_at = NOW()
            WHERE id = ${rows[i].id}
          `;
        }

        embedded += rows.length;
        this.logger.log(`Embedded ${embedded} training pairs so far`);
      }

      this.logger.log(`Embedding backfill done: ${embedded} pairs`);
      return { embedded };
    } catch (error) {
      this.logger.error('Embedding-backfill cron failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'embedding-backfill' },
      });
      return { embedded };
    }
  }
}
