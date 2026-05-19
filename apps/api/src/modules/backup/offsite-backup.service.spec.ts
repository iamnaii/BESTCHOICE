import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OffsiteBackupService } from './offsite-backup.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

// Lightweight fakes for the bits of the GCS SDK we touch.
type FakeFileMetadata = { md5Hash?: string; size?: string; updated?: string };
class FakeFile {
  metadata: FakeFileMetadata;
  copy = jest.fn();
  exists = jest.fn();
  getMetadata = jest.fn();
  delete = jest.fn();
  constructor(
    public name: string,
    metadata: FakeFileMetadata = {},
    public existsResult: boolean = false,
    public existingMd5: string | undefined = undefined,
  ) {
    this.metadata = metadata;
    this.copy.mockResolvedValue(undefined);
    this.exists.mockResolvedValue([existsResult]);
    this.getMetadata.mockResolvedValue([{ md5Hash: existingMd5 } as FakeFileMetadata]);
    this.delete.mockResolvedValue(undefined);
  }
}
class FakeBucket {
  files: FakeFile[];
  fileMap: Map<string, FakeFile>;
  constructor(files: FakeFile[] = []) {
    this.files = files;
    this.fileMap = new Map(files.map((f) => [f.name, f]));
  }
  // Accepts the paginated form `{ prefix, autoPaginate, maxResults, pageToken }`
  // — the production code passes `autoPaginate: false`. Returns
  // `[files, nextQuery]` where nextQuery.pageToken is undefined for the
  // single-page fake (no need to paginate fixture lists).
  getFiles = jest.fn(async ({ prefix }: { prefix: string }) => {
    return [this.files.filter((f) => f.name.startsWith(prefix)), null];
  });
  file = jest.fn((name: string) => {
    let f = this.fileMap.get(name);
    if (!f) {
      f = new FakeFile(name);
      this.fileMap.set(name, f);
      this.files.push(f);
    }
    return f;
  });
}

function makeFakeStorage(bucketMap: Record<string, FakeBucket>) {
  return {
    bucket: jest.fn((name: string) => {
      if (!bucketMap[name]) bucketMap[name] = new FakeBucket();
      return bucketMap[name];
    }),
  } as unknown as Parameters<OffsiteBackupService['setStorageClient']>[0];
}

describe('OffsiteBackupService', () => {
  let service: OffsiteBackupService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: any;
  // Captured copy of OffsiteBackupRun rows created during a run.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createdRuns: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let updatedRuns: any[];

  beforeEach(async () => {
    createdRuns = [];
    updatedRuns = [];
    prisma = {
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      offsiteBackupRun: {
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          const row = { id: `run-${createdRuns.length + 1}`, ...args.data };
          createdRuns.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
          updatedRuns.push(args);
          return Promise.resolve({ id: args.where.id, ...args.data });
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Default: advisory lock acquired. Individual tests can override
      // with mockResolvedValueOnce({ acquired: false }) to simulate
      // contention.
      $queryRaw: jest.fn().mockResolvedValue([{ acquired: true }]),
    };
    config = {
      get: jest.fn((key: string) => {
        const env: Record<string, string> = {
          OFFSITE_BACKUP_DEST_BUCKET: 'dest-bkt',
          OFFSITE_BACKUP_SQL_PREFIX: 'cloudsql/',
          OFFSITE_BACKUP_SQL_SOURCE_BUCKET: 'sql-src',
          OFFSITE_BACKUP_RETENTION_DAYS: '30',
          GCS_BUCKET: 'docs-src',
        };
        return env[key];
      }),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        OffsiteBackupService,
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(OffsiteBackupService);
  });

  describe('isEnabled', () => {
    it('reads SystemConfig OFFSITE_BACKUP_ENABLED first', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      await expect(service.isEnabled()).resolves.toBe(true);
    });

    it('SystemConfig false overrides env var', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
      config.get.mockReturnValueOnce('true');
      await expect(service.isEnabled()).resolves.toBe(false);
    });

    it('falls back to env var when SystemConfig absent', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue(null);
      config.get.mockImplementation((k: string) =>
        k === 'OFFSITE_BACKUP_ENABLED' ? 'true' : undefined,
      );
      await expect(service.isEnabled()).resolves.toBe(true);
    });

    it('defaults to false when neither source is set', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue(null);
      config.get.mockReturnValue(undefined);
      await expect(service.isEnabled()).resolves.toBe(false);
    });
  });

  describe('run — disabled path', () => {
    it('writes a SKIPPED row when disabled and does not touch GCS', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
      const bucketMap: Record<string, FakeBucket> = {};
      service.setStorageClient(makeFakeStorage(bucketMap));

      const result = await service.run({ triggeredBy: 'cron' });
      expect(result.status).toBe('SKIPPED');
      expect(result.filesCount).toBe(0);
      expect(createdRuns).toHaveLength(1);
      expect(createdRuns[0].status).toBe('SKIPPED');
      expect(createdRuns[0].triggeredBy).toBe('cron');
      expect(Object.keys(bucketMap)).toHaveLength(0); // never asked for a bucket
    });
  });

  describe('run — enabled path', () => {
    beforeEach(() => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
    });

    it('copies new SQL dumps + recent docs and records a SUCCESS run row', async () => {
      const sqlSrc = new FakeBucket([
        new FakeFile('cloudsql/2026-05-18.sql.gz', { size: '1024', md5Hash: 'abc' }),
      ]);
      const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const docsSrc = new FakeBucket([
        new FakeFile('contracts/abc.pdf', { size: '512', md5Hash: 'd1', updated: recent }),
      ]);
      const dest = new FakeBucket();
      const bucketMap: Record<string, FakeBucket> = {
        'sql-src': sqlSrc,
        'docs-src': docsSrc,
        'dest-bkt': dest,
      };
      service.setStorageClient(makeFakeStorage(bucketMap));

      const result = await service.run({ triggeredBy: 'cron' });
      expect(result.status).toBe('SUCCESS');
      expect(result.filesCount).toBe(2);
      expect(result.totalBytes).toBe(1024 + 512);
      // Each source file gets copied to the destination via copy(destFile)
      expect(sqlSrc.files[0].copy).toHaveBeenCalledTimes(1);
      expect(docsSrc.files[0].copy).toHaveBeenCalledTimes(1);
      // RUNNING -> SUCCESS row writes
      expect(createdRuns[0].status).toBe('RUNNING');
      const finalUpdate = updatedRuns[0].data;
      expect(finalUpdate.status).toBe('SUCCESS');
      expect(finalUpdate.filesCount).toBe(2);
      expect(finalUpdate.totalBytes).toBe(BigInt(1024 + 512));
    });

    it('idempotent — skips files whose dest md5 matches the source', async () => {
      const sqlSrc = new FakeBucket([
        new FakeFile('cloudsql/2026-05-18.sql.gz', { size: '1024', md5Hash: 'abc' }),
      ]);
      const docsSrc = new FakeBucket();
      const dest = new FakeBucket();
      service.setStorageClient(
        makeFakeStorage({
          'sql-src': sqlSrc,
          'docs-src': docsSrc,
          'dest-bkt': dest,
        }),
      );
      // First run — populate dest
      await service.run({ triggeredBy: 'cron' });
      expect(sqlSrc.files[0].copy).toHaveBeenCalledTimes(1);

      // Set up the dest file as already existing with matching md5
      const destFile = dest.fileMap.get('sql/2026-05-18.sql.gz');
      expect(destFile).toBeDefined();
      destFile!.exists.mockResolvedValue([true]);
      destFile!.getMetadata.mockResolvedValue([{ md5Hash: 'abc' }]);
      sqlSrc.files[0].copy.mockClear();

      // Second run on same day — should skip
      const result = await service.run({ triggeredBy: 'cron' });
      expect(sqlSrc.files[0].copy).not.toHaveBeenCalled();
      expect(result.status).toBe('SUCCESS');
    });

    it('skips docs older than the 26h lookback window', async () => {
      const sqlSrc = new FakeBucket();
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const docsSrc = new FakeBucket([
        new FakeFile('contracts/old.pdf', { size: '100', md5Hash: 'old', updated: old }),
        new FakeFile('contracts/new.pdf', { size: '200', md5Hash: 'new', updated: fresh }),
      ]);
      const dest = new FakeBucket();
      service.setStorageClient(
        makeFakeStorage({
          'sql-src': sqlSrc,
          'docs-src': docsSrc,
          'dest-bkt': dest,
        }),
      );
      const result = await service.run({ triggeredBy: 'cron' });
      expect(result.filesCount).toBe(1);
      expect(result.totalBytes).toBe(200);
      expect(docsSrc.files[0].copy).not.toHaveBeenCalled(); // old.pdf skipped
      expect(docsSrc.files[1].copy).toHaveBeenCalledTimes(1); // new.pdf copied
    });

    it('continues replicating when one file copy fails (per-file fault tolerance)', async () => {
      const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const f1 = new FakeFile('docs/a.pdf', { size: '100', md5Hash: '1', updated: fresh });
      const f2 = new FakeFile('docs/b.pdf', { size: '200', md5Hash: '2', updated: fresh });
      f1.copy.mockRejectedValueOnce(new Error('quota exceeded'));
      const docsSrc = new FakeBucket([f1, f2]);
      service.setStorageClient(
        makeFakeStorage({
          'sql-src': new FakeBucket(),
          'docs-src': docsSrc,
          'dest-bkt': new FakeBucket(),
        }),
      );
      const result = await service.run({ triggeredBy: 'cron' });
      expect(result.status).toBe('SUCCESS'); // run as a whole still succeeded
      expect(result.filesCount).toBe(1); // only f2 was counted
    });

    it('deletes destination objects older than retentionDays during cleanup', async () => {
      const veryOld = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const dest = new FakeBucket([
        new FakeFile('sql/old-dump.sql.gz', { updated: veryOld }),
        new FakeFile('sql/new-dump.sql.gz', { updated: recent }),
        new FakeFile('docs/old.pdf', { updated: veryOld }),
      ]);
      service.setStorageClient(
        makeFakeStorage({
          'sql-src': new FakeBucket(),
          'docs-src': new FakeBucket(),
          'dest-bkt': dest,
        }),
      );
      await service.run({ triggeredBy: 'cron' });
      expect(dest.files[0].delete).toHaveBeenCalled(); // sql/old-dump
      expect(dest.files[1].delete).not.toHaveBeenCalled(); // sql/new-dump
      expect(dest.files[2].delete).toHaveBeenCalled(); // docs/old
    });

    it('skips SQL step gracefully when OFFSITE_BACKUP_SQL_SOURCE_BUCKET is unset', async () => {
      config.get.mockImplementation((k: string) => {
        const env: Record<string, string> = {
          OFFSITE_BACKUP_DEST_BUCKET: 'dest-bkt',
          GCS_BUCKET: 'docs-src',
        };
        return env[k];
      });
      const docsSrc = new FakeBucket();
      service.setStorageClient(
        makeFakeStorage({ 'docs-src': docsSrc, 'dest-bkt': new FakeBucket() }),
      );
      const result = await service.run({ triggeredBy: 'cron' });
      expect(result.status).toBe('SUCCESS');
      expect(result.filesCount).toBe(0);
    });

    it('records a FAILED run when an unexpected error escapes the replication step', async () => {
      // Make getStorage().bucket throw to simulate ADC error.
      const broken = {
        bucket: jest.fn(() => {
          throw new Error('ADC unavailable');
        }),
      } as unknown as Parameters<OffsiteBackupService['setStorageClient']>[0];
      service.setStorageClient(broken);
      const result = await service.run({ triggeredBy: 'manual', triggeredByUserId: 'u1' });
      expect(result.status).toBe('FAILED');
      expect(result.errorMessage).toContain('ADC unavailable');
      expect(updatedRuns[0].data.status).toBe('FAILED');
    });
  });

  describe('setEnabled', () => {
    it('upserts SystemConfig and returns the new value', async () => {
      prisma.systemConfig.upsert.mockResolvedValue({});
      const result = await service.setEnabled(true);
      expect(result).toBe(true);
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'OFFSITE_BACKUP_ENABLED' },
          update: expect.objectContaining({ value: 'true' }),
        }),
      );
    });
  });

  describe('getRecentRuns', () => {
    it('returns the most recent N rows ordered desc and converts BigInt to Number', async () => {
      const rows = [
        {
          id: 'r1',
          startedAt: new Date(),
          finishedAt: new Date(),
          status: 'SUCCESS',
          filesCount: 5,
          totalBytes: BigInt(1024),
          errorMessage: null,
          triggeredBy: 'cron',
          triggeredByUserId: null,
          triggeredByUser: null,
          destBucket: 'dest-bkt',
        },
      ];
      prisma.offsiteBackupRun.findMany.mockResolvedValue(rows);
      const result = await service.getRecentRuns(7);
      expect(result).toHaveLength(1);
      expect(result[0].totalBytes).toBe(1024);
      expect(result[0].triggeredBy).toBe('cron');
      expect(result[0].triggeredByUser).toBeNull();
      expect(prisma.offsiteBackupRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 7,
          orderBy: { startedAt: 'desc' },
          include: expect.objectContaining({
            triggeredByUser: { select: { id: true, name: true, email: true } },
          }),
        }),
      );
    });

    it('joins the manual-trigger user so UI can show name (C2 fix)', async () => {
      const rows = [
        {
          id: 'r2',
          startedAt: new Date(),
          finishedAt: new Date(),
          status: 'SUCCESS',
          filesCount: 1,
          totalBytes: BigInt(1),
          errorMessage: null,
          triggeredBy: 'manual',
          triggeredByUserId: 'u-1',
          triggeredByUser: { id: 'u-1', name: 'Owner Account', email: 'owner@example.com' },
          destBucket: 'dest-bkt',
        },
      ];
      prisma.offsiteBackupRun.findMany.mockResolvedValue(rows);
      const result = await service.getRecentRuns(7);
      expect(result[0].triggeredBy).toBe('manual');
      expect(result[0].triggeredByUser).toEqual({ id: 'u-1', name: 'Owner Account' });
    });
  });

  describe('advisory lock (C1)', () => {
    beforeEach(() => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      service.setStorageClient(
        makeFakeStorage({
          'sql-src': new FakeBucket(),
          'docs-src': new FakeBucket(),
          'dest-bkt': new FakeBucket(),
        }),
      );
    });

    it('throws ConflictException when another run already holds the lock', async () => {
      // First $queryRaw call (lock acquire) returns acquired: false.
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockResolvedValueOnce([{ acquired: false }]);

      await expect(service.run({ triggeredBy: 'cron' })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('สำรองข้อมูลกำลังทำงานอยู่'),
      });
      // No run row should have been created when lock was rejected.
      expect(createdRuns).toHaveLength(0);
    });

    it('releases the lock after a successful run', async () => {
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw
        .mockResolvedValueOnce([{ acquired: true }]) // acquire
        .mockResolvedValueOnce([{ pg_advisory_unlock: true }]); // release

      const result = await service.run({ triggeredBy: 'cron' });
      expect(result.status).toBe('SUCCESS');
      // Acquire + release were both called.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('still releases the lock when the run throws mid-flight', async () => {
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ pg_advisory_unlock: true }]);
      const broken = {
        bucket: jest.fn(() => {
          throw new Error('boom');
        }),
      } as unknown as Parameters<OffsiteBackupService['setStorageClient']>[0];
      service.setStorageClient(broken);
      const result = await service.run({ triggeredBy: 'cron' });
      // Run reports FAILED but lock release still ran (2 $queryRaw calls).
      expect(result.status).toBe('FAILED');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('triggeredByUserId persistence (C2)', () => {
    beforeEach(() => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      service.setStorageClient(
        makeFakeStorage({
          'sql-src': new FakeBucket(),
          'docs-src': new FakeBucket(),
          'dest-bkt': new FakeBucket(),
        }),
      );
    });

    it('persists triggeredBy=cron + triggeredByUserId=null for scheduler runs', async () => {
      await service.run({ triggeredBy: 'cron' });
      expect(createdRuns[0]).toMatchObject({
        status: 'RUNNING',
        triggeredBy: 'cron',
        triggeredByUserId: null,
      });
    });

    it('persists triggeredBy=manual + triggeredByUserId=<id> for manual runs', async () => {
      await service.run({ triggeredBy: 'manual', triggeredByUserId: 'user-uuid-1' });
      expect(createdRuns[0]).toMatchObject({
        status: 'RUNNING',
        triggeredBy: 'manual',
        triggeredByUserId: 'user-uuid-1',
      });
    });

    it('records SKIPPED rows with the same triggeredBy+userId split', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
      await service.run({ triggeredBy: 'manual', triggeredByUserId: 'user-uuid-1' });
      expect(createdRuns[0]).toMatchObject({
        status: 'SKIPPED',
        triggeredBy: 'manual',
        triggeredByUserId: 'user-uuid-1',
      });
    });
  });

  describe('pruneOldRuns (C3 retention)', () => {
    it('deletes rows older than the cutoff and returns the count', async () => {
      prisma.offsiteBackupRun.deleteMany.mockResolvedValue({ count: 12 });
      const result = await service.pruneOldRuns(365);
      expect(result).toBe(12);
      const call = prisma.offsiteBackupRun.deleteMany.mock.calls[0][0];
      expect(call.where.startedAt.lt).toBeInstanceOf(Date);
      // Cutoff is ~365 days back from now.
      const expectedCutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
      expect(Math.abs(call.where.startedAt.lt.getTime() - expectedCutoff)).toBeLessThan(5_000);
    });
  });

  describe('setEnabled (W1)', () => {
    it('revives a soft-deleted SystemConfig row by clearing deletedAt', async () => {
      prisma.systemConfig.upsert.mockResolvedValue({});
      await service.setEnabled(true);
      const args = prisma.systemConfig.upsert.mock.calls[0][0];
      expect(args.update).toMatchObject({ value: 'true', deletedAt: null });
    });
  });

  describe('config getters', () => {
    it('getDestBucket falls back to default name when env unset', () => {
      config.get.mockReturnValue(undefined);
      expect(service.getDestBucket()).toBe('bestchoice-backups-offsite');
    });

    it('getSqlPrefix appends trailing slash when missing', () => {
      config.get.mockImplementation((k: string) =>
        k === 'OFFSITE_BACKUP_SQL_PREFIX' ? 'cloudsql' : undefined,
      );
      expect(service.getSqlPrefix()).toBe('cloudsql/');
    });

    it('getRetentionDays defaults to 30 when env unset / invalid', () => {
      config.get.mockReturnValue(undefined);
      expect(service.getRetentionDays()).toBe(30);
      config.get.mockReturnValue('not-a-number');
      expect(service.getRetentionDays()).toBe(30);
      config.get.mockReturnValue('60');
      expect(service.getRetentionDays()).toBe(60);
    });
  });

  // ─── SP7.8 — Dual-DB Cloud SQL backup ────────────────────────────────────

  describe('backupAllDatabases (SP7.8)', () => {
    const SHOP_KEY = 'CLOUDSQL_SHOP_INSTANCE';
    const FINANCE_KEY = 'CLOUDSQL_FINANCE_INSTANCE';

    afterEach(() => {
      delete process.env[SHOP_KEY];
      delete process.env[FINANCE_KEY];
    });

    it('skips both DBs and returns error-env-not-set when neither env var is set', async () => {
      delete process.env[SHOP_KEY];
      delete process.env[FINANCE_KEY];

      const results = await service.backupAllDatabases();

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ db: 'bc_shop', status: 'error', error: 'env-not-set' });
      expect(results[1]).toMatchObject({ db: 'bc_finance', status: 'error', error: 'env-not-set' });
    });

    it('returns ok for configured DB and skips unconfigured one', async () => {
      process.env[SHOP_KEY] = 'project:region:bc-shop';
      delete process.env[FINANCE_KEY];

      const results = await service.backupAllDatabases();

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ db: 'bc_shop', status: 'ok' });
      expect(results[1]).toMatchObject({ db: 'bc_finance', status: 'error', error: 'env-not-set' });
    });

    it('returns ok for both when both env vars are set', async () => {
      process.env[SHOP_KEY] = 'project:region:bc-shop';
      process.env[FINANCE_KEY] = 'project:region:bc-finance';

      const results = await service.backupAllDatabases();

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ db: 'bc_shop', status: 'ok' });
      expect(results[1]).toMatchObject({ db: 'bc_finance', status: 'ok' });
    });

    it('captures partial failure — one ok, one error', async () => {
      process.env[SHOP_KEY] = 'project:region:bc-shop';
      process.env[FINANCE_KEY] = 'project:region:bc-finance';

      // Spy on backupSingleDatabase via prototype to inject a failure for finance
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spy = jest.spyOn(service as any, 'backupSingleDatabase');
      spy.mockResolvedValueOnce(undefined); // shop: ok
      spy.mockRejectedValueOnce(new Error('Cloud SQL export failed')); // finance: error

      const results = await service.backupAllDatabases();

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ db: 'bc_shop', status: 'ok' });
      expect(results[1]).toMatchObject({
        db: 'bc_finance',
        status: 'error',
        error: 'Cloud SQL export failed',
      });

      spy.mockRestore();
    });

    it('DB_INSTANCES static list matches expected db names', () => {
      const names = OffsiteBackupService.DB_INSTANCES.map((i) => i.name);
      expect(names).toEqual(['bc_shop', 'bc_finance']);
    });
  });
});
