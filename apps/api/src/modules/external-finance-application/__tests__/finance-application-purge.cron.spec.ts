jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';
import { FinanceApplicationPurgeCron } from '../crons/finance-application-purge.cron';

const old = new Date(Date.now() - 91 * 86400000);
const recent = new Date(Date.now() - 10 * 86400000);

function make(apps: any[]) {
  const txFile = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
  const txApp = { update: jest.fn().mockResolvedValue({}) };
  const txEvent = { create: jest.fn().mockResolvedValue({}) };
  const prisma = {
    externalFinanceApplication: { findMany: jest.fn().mockResolvedValue(apps), update: jest.fn().mockResolvedValue({}) },
    externalFinanceApplicationFile: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((fn: any) => fn({ externalFinanceApplicationFile: txFile, externalFinanceApplication: txApp, externalFinanceApplicationEvent: txEvent })),
  } as any;
  const storage = { delete: jest.fn().mockResolvedValue(undefined) } as any;
  return { prisma, storage, txFile, txApp, txEvent, cron: new FinanceApplicationPurgeCron(prisma, storage) };
}

beforeEach(() => {
  (Sentry.captureMessage as jest.Mock).mockClear();
  (Sentry.captureException as jest.Mock).mockClear();
});

describe('FinanceApplicationPurgeCron', () => {
  it('deletes storage objects of applications closed ≥ 90 days ago, nulls storageKey, stamps filesPurgedAt and logs FILES_PURGED', async () => {
    const { prisma, storage, txFile, txApp, txEvent, cron } = make([{ id: 'a1', closedAt: old, files: [{ id: 'f1', storageKey: 'k1' }, { id: 'f2', storageKey: 'k2' }] }]);
    const result = await cron.tick();
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ purgedApplications: 1, purgedFiles: 2, failedFiles: 0 });
    const where = prisma.externalFinanceApplication.findMany.mock.calls[0][0].where;
    expect(where.filesPurgedAt).toBeNull();
    expect(where.closedAt.lte).toBeInstanceOf(Date);
    expect(txFile.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['f1', 'f2'] } }, data: { storageKey: null } });
    expect(txApp.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { filesPurgedAt: expect.any(Date), shareRevokedAt: expect.any(Date) } });
    expect(txEvent.create).toHaveBeenCalledWith({ data: { applicationId: 'a1', kind: 'FILES_PURGED', actorType: 'SYSTEM', meta: { fileCount: 2 } } });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('keeps going when one object delete fails: the failed file keeps its storageKey, filesPurgedAt stays null, and Sentry is warned once', async () => {
    const { storage, txFile, txApp, txEvent, cron } = make([{ id: 'a1', closedAt: old, files: [{ id: 'f1', storageKey: 'k1' }, { id: 'f2', storageKey: 'k2' }] }]);
    storage.delete.mockImplementation(async (key: string) => {
      if (key === 'k1') throw new Error('s3 down');
    });
    const result = await cron.tick();
    expect(result).toEqual({ purgedApplications: 0, purgedFiles: 1, failedFiles: 1 });
    // only the succeeded file (f2) gets its storageKey nulled — f1 (failed) is left alone so the next run retries it
    expect(txFile.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['f2'] } }, data: { storageKey: null } });
    // shareRevokedAt is still stamped even on partial failure, but filesPurgedAt is NOT (so this app stays in the retry queue)
    expect(txApp.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { shareRevokedAt: expect.any(Date) } });
    expect(txApp.update.mock.calls[0][0].data).not.toHaveProperty('filesPurgedAt');
    expect(txEvent.create).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('finance-application-purge'),
      expect.objectContaining({ level: 'warning', tags: { subsystem: 'finance-application-purge' }, extra: { applicationId: 'a1', storageKey: 'k1' } }),
    );
  });

  it('a later run with the delete succeeding completes the purge (retry picks up only the file that still has a storageKey)', async () => {
    // simulates the second tick(): the query's `storageKey: { not: null }` filter means only the
    // previously-failed file (f1) is selected this time — f2 was already nulled on the first run
    const { storage, txFile, txApp, txEvent, cron } = make([{ id: 'a1', closedAt: old, files: [{ id: 'f1', storageKey: 'k1' }] }]);
    const result = await cron.tick();
    expect(storage.delete).toHaveBeenCalledWith('k1');
    expect(result).toEqual({ purgedApplications: 1, purgedFiles: 1, failedFiles: 0 });
    expect(txFile.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['f1'] } }, data: { storageKey: null } });
    expect(txApp.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { filesPurgedAt: expect.any(Date), shareRevokedAt: expect.any(Date) } });
    expect(txEvent.create).toHaveBeenCalledWith({ data: { applicationId: 'a1', kind: 'FILES_PURGED', actorType: 'SYSTEM', meta: { fileCount: 1 } } });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('never touches open applications or ones closed less than 90 days ago (query shape)', async () => {
    const { prisma, cron } = make([]);
    await cron.tick();
    const where = prisma.externalFinanceApplication.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['APPROVED', 'REJECTED', 'CANCELLED']);
    expect(where.closedAt.lte.getTime()).toBeLessThan(recent.getTime());
  });
});
