import { EmbeddingBackfillCron } from './embedding-backfill.cron';

describe('EmbeddingBackfillCron', () => {
  const makeEmbedding = (ready = true) => ({
    isReady: jest.fn().mockReturnValue(ready),
    getModel: jest.fn().mockReturnValue('text-multilingual-embedding-002'),
    embedBatch: jest.fn().mockResolvedValue([[0.1, 0.2]]),
    toPgvector: jest.fn((v: number[]) => `[${v.join(',')}]`),
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
});
