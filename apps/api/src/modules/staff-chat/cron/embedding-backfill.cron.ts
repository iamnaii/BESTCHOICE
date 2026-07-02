import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmbeddingService } from '../services/embedding.service';

const EMBED_BATCH = 100;
// กัน runaway คืนแรกที่ backfill ของเก่าทั้งหมด — ทยอยจบเอง หรือยิง manual trigger ซ้ำได้
const NIGHTLY_CAP = 5000;
// stamped onto embedding_model for rows ที่ embed ไม่สำเร็จถาวร (poison row) — กันไม่ให้
// pickup query (WHERE embedding_model IS NULL) หยิบแถวเดิมมา retry วนไม่รู้จบ
const EMBED_FAILED_MARKER = 'EMBED_FAILED';

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
            AND embedding_model IS NULL
            AND customer_message <> ''
            AND btrim(customer_message) <> ''
          ORDER BY created_at ASC
          LIMIT ${batchSize}
        `;
        if (rows.length === 0) break;

        embedded += await this.embedBatchWithFallback(rows);
        this.logger.log(`Embedded ${embedded} training pairs so far`);
      }

      this.logger.log(`Embedding backfill done: ${embedded} pairs`);
      return { embedded };
    } catch (error) {
      // whole-run safety net — non-batch errors เช่น auth failure ที่ retry ต่อไม่ได้
      this.logger.error('Embedding-backfill cron failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'embedding-backfill' },
      });
      return { embedded };
    }
  }

  /**
   * Embed หนึ่ง batch. ถ้า Vertex call ทั้ง batch throw (poison row — customer_message
   * ว่าง/ยาวเกิน → Vertex 400 ทำให้ batch ทั้งก้อนพัง) ให้ fallback ไป embed ทีละแถวแทน
   * เพื่อไม่ให้แถวดีๆ ที่เหลือใน batch เดียวกันพลอยไม่ได้ embed ไปด้วย แถวที่ยัง fail
   * ซ้ำแม้ embed ทีละแถวจะถูก mark ถาวร (EMBED_FAILED) ไม่ให้ query หยิบมา retry อีก
   *
   * ถ้าทุกแถวใน batch fail แม้ retry ทีละแถวแล้ว (failures === rows.length) นี่ไม่ใช่
   * poison row อีกต่อไป — เป็น systemic outage (เช่น Vertex auth พัง/ทั้งระบบล่ม) ห้าม
   * stamp EMBED_FAILED ให้แถวพวกนี้ (ยังไม่พิสูจน์ว่าพังถาวร แค่ระบบล่มชั่วคราว) แทนที่จะ
   * capture Sentry ทีละแถว (spam) ให้ rethrow ไปให้ run-level catch จับแทน (Sentry capture
   * ครั้งเดียวต่อ run) แล้ว cron หยุดพยายาม batch ถัดไป — คืนจำนวนที่ embed สำเร็จจาก batch
   * ก่อนหน้าเท่านั้น
   *
   * Returns จำนวนแถวที่ embed สำเร็จ
   */
  private async embedBatchWithFallback(
    rows: { id: string; customer_message: string }[],
  ): Promise<number> {
    const model = this.embedding.getModel();
    try {
      const vectors = await this.embedding.embedBatch(
        rows.map((r) => r.customer_message),
        'RETRIEVAL_DOCUMENT',
      );
      for (let i = 0; i < rows.length; i++) {
        await this.saveEmbedding(rows[i].id, vectors[i], model);
      }
      return rows.length;
    } catch {
      let succeeded = 0;
      const failures: { id: string; error: unknown }[] = [];
      for (const row of rows) {
        try {
          const [vector] = await this.embedding.embedBatch(
            [row.customer_message],
            'RETRIEVAL_DOCUMENT',
          );
          await this.saveEmbedding(row.id, vector, model);
          succeeded++;
        } catch (rowError) {
          failures.push({ id: row.id, error: rowError });
        }
      }

      if (failures.length === rows.length) {
        throw new Error(
          `Embedding backfill batch failed systemically — all ${rows.length} row(s) failed per-row retry too`,
        );
      }

      for (const { id, error } of failures) {
        this.logger.error(`Embedding failed permanently for training pair ${id}`, error);
        Sentry.captureException(error, {
          tags: { kind: 'cron-job', cron: 'embedding-backfill' },
          extra: { trainingPairId: id },
        });
        await this.markFailed(id);
      }
      return succeeded;
    }
  }

  private async saveEmbedding(id: string, vector: number[], model: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE ai_training_pairs
      SET embedding = ${this.embedding.toPgvector(vector)}::vector,
          embedding_model = ${model},
          embedded_at = NOW()
      WHERE id = ${id}
    `;
  }

  /** Permanently skip a poison row — embedding stays NULL, embedding_model marks it dead. */
  private async markFailed(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE ai_training_pairs
      SET embedding_model = ${EMBED_FAILED_MARKER},
          embedded_at = NOW()
      WHERE id = ${id}
    `;
  }
}
