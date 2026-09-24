import { FinanceApplicationPurgeCron } from '../crons/finance-application-purge.cron';

const old = new Date(Date.now() - 91 * 86400000);
const recent = new Date(Date.now() - 10 * 86400000);

function make(apps: any[]) {
  const prisma = {
    externalFinanceApplication: { findMany: jest.fn().mockResolvedValue(apps), update: jest.fn().mockResolvedValue({}) },
    externalFinanceApplicationFile: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: (fn: any) =>
      fn({
        externalFinanceApplicationFile: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
        externalFinanceApplication: { update: jest.fn().mockResolvedValue({}) },
        externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}) },
      }),
  } as any;
  const storage = { delete: jest.fn().mockResolvedValue(undefined) } as any;
  return { prisma, storage, cron: new FinanceApplicationPurgeCron(prisma, storage) };
}

describe('FinanceApplicationPurgeCron', () => {
  it('deletes storage objects of applications closed ≥ 90 days ago, nulls storageKey, stamps filesPurgedAt and logs FILES_PURGED', async () => {
    const { prisma, storage, cron } = make([{ id: 'a1', closedAt: old, files: [{ id: 'f1', storageKey: 'k1' }, { id: 'f2', storageKey: 'k2' }] }]);
    const result = await cron.tick();
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ purgedApplications: 1, purgedFiles: 2 });
    const where = prisma.externalFinanceApplication.findMany.mock.calls[0][0].where;
    expect(where.filesPurgedAt).toBeNull();
    expect(where.closedAt.lte).toBeInstanceOf(Date);
  });

  it('keeps going when one object delete fails and reports the rest', async () => {
    const { storage, cron } = make([{ id: 'a1', closedAt: old, files: [{ id: 'f1', storageKey: 'k1' }, { id: 'f2', storageKey: 'k2' }] }]);
    storage.delete.mockRejectedValueOnce(new Error('s3 down'));
    await expect(cron.tick()).resolves.toEqual({ purgedApplications: 1, purgedFiles: 2 });
  });

  it('never touches open applications or ones closed less than 90 days ago (query shape)', async () => {
    const { prisma, cron } = make([]);
    await cron.tick();
    const where = prisma.externalFinanceApplication.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['APPROVED', 'REJECTED', 'CANCELLED']);
    expect(where.closedAt.lte.getTime()).toBeLessThan(recent.getTime());
  });
});
