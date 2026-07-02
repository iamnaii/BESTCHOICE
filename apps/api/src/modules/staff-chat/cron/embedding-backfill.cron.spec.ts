import * as Sentry from '@sentry/nestjs';
import { EmbeddingBackfillCron } from './embedding-backfill.cron';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

describe('EmbeddingBackfillCron', () => {
  const makeEmbedding = (ready = true) => ({
    isReady: jest.fn().mockReturnValue(ready),
    getModel: jest.fn().mockReturnValue('text-multilingual-embedding-002'),
    embedBatch: jest.fn().mockResolvedValue([[0.1, 0.2]]),
    toPgvector: jest.fn((v: number[]) => `[${v.join(',')}]`),
  });

  beforeEach(() => {
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it('skips entirely when the embedding service is not ready', async () => {
    const prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
    const cron = new EmbeddingBackfillCron(prisma as any, makeEmbedding(false) as any);
    const res = await cron.backfillEmbeddings();
    expect(res.embedded).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('embeds null-embedding rows in batches and stops when drained', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'a', customer_message: 'ผ่อนยังไง' },
          { id: 'b', customer_message: 'ร้านอยู่ไหน' },
        ])
        .mockResolvedValueOnce([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const embedding = makeEmbedding();
    embedding.embedBatch.mockResolvedValue([[0.1], [0.2]]);
    const cron = new EmbeddingBackfillCron(prisma as any, embedding as any);
    const res = await cron.backfillEmbeddings();
    expect(embedding.embedBatch).toHaveBeenCalledWith(
      ['ผ่อนยังไง', 'ร้านอยู่ไหน'],
      'RETRIEVAL_DOCUMENT',
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(res.embedded).toBe(2);
  });

  it('returns the partial count when a batch throws (Sentry captured, no crash)', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValueOnce([{ id: 'a', customer_message: 'x' }]),
      $executeRaw: jest.fn(),
    };
    const embedding = makeEmbedding();
    embedding.embedBatch.mockRejectedValue(new Error('vertex down'));
    const cron = new EmbeddingBackfillCron(prisma as any, embedding as any);
    const res = await cron.backfillEmbeddings();
    expect(res.embedded).toBe(0);
  });

  it('pickup query excludes empty/whitespace customer_message and permanently-failed rows', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValueOnce([]),
      $executeRaw: jest.fn(),
    };
    const cron = new EmbeddingBackfillCron(prisma as any, makeEmbedding() as any);
    await cron.backfillEmbeddings();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings] = prisma.$queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('');
    expect(sql).toContain('embedding IS NULL');
    expect(sql).toContain('embedding_model IS NULL');
    expect(sql).toContain("customer_message <> ''");
    expect(sql).toContain("btrim(customer_message) <> ''");
  });

  it('poison batch: per-row fallback embeds the healthy row and permanently skips the bad one', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'a', customer_message: 'good' },
          { id: 'b', customer_message: 'bad' },
        ])
        .mockResolvedValueOnce([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const embedding = makeEmbedding();
    embedding.embedBatch
      .mockRejectedValueOnce(new Error('batch poison')) // whole-batch call fails
      .mockResolvedValueOnce([[0.1, 0.2]]) // per-row retry: row a succeeds
      .mockRejectedValueOnce(new Error('row b poison')); // per-row retry: row b fails permanently

    const cron = new EmbeddingBackfillCron(prisma as any, embedding as any);
    const res = await cron.backfillEmbeddings();

    // 1 whole-batch call + 2 per-row fallback calls
    expect(embedding.embedBatch).toHaveBeenCalledTimes(3);
    expect(embedding.embedBatch).toHaveBeenNthCalledWith(1, ['good', 'bad'], 'RETRIEVAL_DOCUMENT');
    expect(embedding.embedBatch).toHaveBeenNthCalledWith(2, ['good'], 'RETRIEVAL_DOCUMENT');
    expect(embedding.embedBatch).toHaveBeenNthCalledWith(3, ['bad'], 'RETRIEVAL_DOCUMENT');

    // row a: UPDATE with vector + model; row b: UPDATE stamping EMBED_FAILED, embedding untouched
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw.mock.calls[0]).toEqual(
      expect.arrayContaining(['[0.1,0.2]', 'text-multilingual-embedding-002', 'a']),
    );
    expect(prisma.$executeRaw.mock.calls[1]).toEqual(expect.arrayContaining(['EMBED_FAILED', 'b']));

    // Sentry captured once for the permanently-failed row, with the row id in extra
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ cron: 'embedding-backfill' }),
        extra: { trainingPairId: 'b' },
      }),
    );

    // run continues past the poison batch (queryRaw called again, resolves []) —
    // only row a counts toward the returned total
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(res.embedded).toBe(1);
  });

  it('systemic outage: batch fails AND every per-row retry in that batch also fails → treated as systemic, not poison rows', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'a', customer_message: 'fine before outage' }])
        .mockResolvedValueOnce([
          { id: 'b', customer_message: 'x' },
          { id: 'c', customer_message: 'y' },
        ]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const embedding = makeEmbedding();
    embedding.embedBatch
      .mockResolvedValueOnce([[0.1]]) // batch 1 whole-batch call succeeds
      .mockRejectedValueOnce(new Error('vertex outage')) // batch 2 whole-batch call fails
      .mockRejectedValueOnce(new Error('vertex outage row b')) // batch 2 per-row retry b fails
      .mockRejectedValueOnce(new Error('vertex outage row c')); // batch 2 per-row retry c fails

    const cron = new EmbeddingBackfillCron(prisma as any, embedding as any);
    const res = await cron.backfillEmbeddings();

    // batch 1's row a was saved normally
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0]).toEqual(
      expect.arrayContaining(['[0.1]', 'text-multilingual-embedding-002', 'a']),
    );

    // NEITHER row from the systemically-failed batch got permanently stamped —
    // a total-outage batch must not poison rows that may embed fine once Vertex recovers
    const stampedFailed = prisma.$executeRaw.mock.calls.some((call) =>
      (call as unknown[]).includes('EMBED_FAILED'),
    );
    expect(stampedFailed).toBe(false);

    // the run stops after the systemic batch — does not keep looping/retrying it
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);

    // exactly ONE Sentry capture for the whole run (not one per poisoned row)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [errArg, ctxArg] = (Sentry.captureException as jest.Mock).mock.calls[0];
    expect((errArg as Error).message.toLowerCase()).toContain('systemic');
    expect(ctxArg).toEqual(
      expect.objectContaining({ tags: expect.objectContaining({ cron: 'embedding-backfill' }) }),
    );

    // returns the partial count accumulated from the batch that succeeded before the outage
    expect(res.embedded).toBe(1);
  });
});
