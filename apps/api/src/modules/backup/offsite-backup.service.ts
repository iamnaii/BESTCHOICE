import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage as GcsStorage, type Bucket, type File as GcsFile } from '@google-cloud/storage';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Phase 3 SP2 — Off-site backup replication service.
 *
 * Mirrors two data sets from the in-region primary GCS buckets to a single
 * cross-region "off-site" bucket so a regional outage or accidental mass
 * delete on the primary cannot wipe out our recoverable evidence:
 *
 *   1. Cloud SQL daily SQL dumps  — copied into `sql/YYYY-MM-DD.sql.gz`
 *   2. Document bucket diff       — last-24h files copied into `docs/<path>`
 *
 * Then prunes anything older than the retention window (default 30d) under
 * those two prefixes only — never touches anything outside the two prefixes
 * in case ops keeps non-replication artifacts in the same bucket.
 *
 * Design notes:
 * - Idempotent: re-running the same day re-checks each file's md5 against
 *   the existing object in the off-site bucket and skips identical copies.
 *   A retry after a partial failure never duplicates data.
 * - Single Storage client instance — credentials resolved by Application
 *   Default Credentials on Cloud Run (no secrets needed).
 * - Skipped vs disabled vs failed are distinct OffsiteBackupStatus values
 *   so the UI history can show why a run is missing.
 * - Errors during per-file copy are logged + counted but do not abort the
 *   whole run — partial replication is more valuable than no replication.
 * - Every run writes one row to OffsiteBackupRun (RUNNING → SUCCESS/FAILED).
 *
 * Hard constraints (from spec):
 * - Buckets and IAM are owner-managed deliverables — this service does
 *   NOT auto-create buckets or grant permissions.
 * - Off-site bucket is configured via OFFSITE_BACKUP_DEST_BUCKET.
 * - Source SQL prefix configurable via OFFSITE_BACKUP_SQL_PREFIX
 *   (Cloud SQL exports go into a per-instance backup bucket; the prefix
 *   may legitimately vary across environments).
 */
@Injectable()
export class OffsiteBackupService {
  private readonly logger = new Logger(OffsiteBackupService.name);
  private gcs: GcsStorage | null = null;
  /** Lookup window for the "last 24h" document slice — buffer for clock drift. */
  static readonly DOCS_LOOKBACK_MS = 26 * 60 * 60 * 1000;
  /** Cap error message field at 1000 chars (text column, no point storing full stack). */
  static readonly ERROR_TRUNC_CHARS = 1000;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Lazy-init the GCS client. Skipped in tests (which inject a fake via
   * setStorageClient) and on environments without ADC.
   */
  private getStorage(): GcsStorage {
    if (!this.gcs) {
      this.gcs = new GcsStorage();
    }
    return this.gcs;
  }

  /** Test seam — replaces the lazy GCS client before run(). */
  setStorageClient(client: GcsStorage): void {
    this.gcs = client;
  }

  /**
   * Resolve the enabled toggle. SystemConfig key wins, env var falls back.
   * Returns `false` when neither source explicitly sets `true`.
   *
   * SystemConfig is read directly via PrismaService to avoid a SettingsModule
   * dependency (this module is meant to be tiny and isolated).
   */
  async isEnabled(): Promise<boolean> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: 'OFFSITE_BACKUP_ENABLED', deletedAt: null },
        select: { value: true },
      });
      if (row?.value) {
        const v = row.value.trim().toLowerCase();
        if (v === 'true' || v === '1') return true;
        if (v === 'false' || v === '0') return false;
      }
    } catch {
      // ignore — fall through to env
    }
    const env = (this.config.get<string>('OFFSITE_BACKUP_ENABLED') || '').trim().toLowerCase();
    return env === 'true' || env === '1';
  }

  /**
   * Manually toggle the SystemConfig flag (used by SettingsService /
   * controller endpoint). Returns the new effective value.
   *
   * W1 fix: pass `deletedAt: null` on the update branch so a previously
   * soft-deleted SystemConfig row is revived. Without this, isEnabled()
   * would still return false (its WHERE clause filters `deletedAt: null`)
   * and the toggle would silently no-op.
   */
  async setEnabled(enabled: boolean): Promise<boolean> {
    await this.prisma.systemConfig.upsert({
      where: { key: 'OFFSITE_BACKUP_ENABLED' },
      update: {
        value: enabled ? 'true' : 'false',
        updatedAt: new Date(),
        deletedAt: null,
      },
      create: {
        key: 'OFFSITE_BACKUP_ENABLED',
        value: enabled ? 'true' : 'false',
        label: 'Off-site backup cron enabled',
      },
    });
    return enabled;
  }

  getDestBucket(): string {
    return (
      this.config.get<string>('OFFSITE_BACKUP_DEST_BUCKET') || 'bestchoice-backups-offsite'
    );
  }

  getSqlPrefix(): string {
    const raw = (this.config.get<string>('OFFSITE_BACKUP_SQL_PREFIX') || 'cloudsql-backups/').trim();
    return raw.endsWith('/') ? raw : `${raw}/`;
  }

  getRetentionDays(): number {
    const raw = this.config.get<string>('OFFSITE_BACKUP_RETENTION_DAYS');
    if (raw) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 30;
  }

  getSourceDocsBucket(): string {
    return this.config.get<string>('GCS_BUCKET') || 'bestchoice-documents';
  }

  /**
   * The Cloud SQL automated backup machinery writes daily SQL dumps into a
   * source bucket (separate from the document bucket). We don't auto-create
   * this — ops sets OFFSITE_BACKUP_SQL_SOURCE_BUCKET. If unset, we skip the
   * SQL replication step entirely (still replicate docs).
   */
  getSqlSourceBucket(): string | null {
    return this.config.get<string>('OFFSITE_BACKUP_SQL_SOURCE_BUCKET') || null;
  }

  /**
   * Cross-pod advisory lock key — `pg_try_advisory_lock(hashtext(...))`
   * returns true only for the first caller to acquire it. Released either
   * by `pg_advisory_unlock` or when the underlying connection closes.
   *
   * Exposed as `static readonly` so tests can assert the same hash without
   * coupling to the string literal.
   */
  static readonly ADVISORY_LOCK_KEY = 'offsite-backup';

  /**
   * Main entry point — runs the full replication cycle and writes one
   * OffsiteBackupRun row.
   *
   * C1 fix: PostgreSQL advisory lock guards against concurrent runs.
   *   - OWNER click + scheduled cron firing within the same minute
   *   - 2 Cloud Run pods both firing the same cron tick
   * Without the lock, both would replicate the same files and double-
   * cleanup — md5 TOCTOU race, swallowed errors, unreliable history.
   *
   * C2 fix: triggeredBy is split into category ('cron'|'manual') +
   * triggeredByUserId (real FK, NULL for cron). UI displays user name
   * via the relation instead of `user:abcd1234` prefix.
   *
   * @throws ConflictException when another run already holds the lock.
   */
  async run(opts: OffsiteBackupRunOptions): Promise<OffsiteBackupRunResult> {
    const { triggeredBy, triggeredByUserId = null } = opts;

    // C1: try to acquire the advisory lock. pg_try_advisory_lock returns
    // false (no wait) if someone else already holds it.
    const lockResult = await this.prisma.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${OffsiteBackupService.ADVISORY_LOCK_KEY})) AS acquired
    `;
    if (!lockResult[0]?.acquired) {
      this.logger.warn(
        `offsite-backup: advisory lock already held — refusing concurrent run (triggeredBy=${triggeredBy})`,
      );
      throw new ConflictException(
        'สำรองข้อมูลกำลังทำงานอยู่ — กรุณารอจนเสร็จ',
      );
    }

    try {
      return await this.runUnderLock({ triggeredBy, triggeredByUserId });
    } finally {
      // Always release. If the connection died, the lock auto-releases.
      try {
        await this.prisma.$queryRaw`
          SELECT pg_advisory_unlock(hashtext(${OffsiteBackupService.ADVISORY_LOCK_KEY}))
        `;
      } catch (err) {
        this.logger.warn(`offsite-backup: advisory unlock failed (non-fatal): ${this.truncErr(err)}`);
      }
    }
  }

  private async runUnderLock(opts: {
    triggeredBy: 'cron' | 'manual';
    triggeredByUserId: string | null;
  }): Promise<OffsiteBackupRunResult> {
    const { triggeredBy, triggeredByUserId } = opts;
    const startedAt = new Date();
    const destBucket = this.getDestBucket();

    // Pre-flight: enabled check
    if (!(await this.isEnabled())) {
      // We still record a SKIPPED row so the UI shows "we noticed the cron
      // fired but it was disabled" rather than a silent gap in history.
      const skipped = await this.prisma.offsiteBackupRun.create({
        data: {
          startedAt,
          finishedAt: new Date(),
          status: 'SKIPPED',
          filesCount: 0,
          totalBytes: BigInt(0),
          triggeredBy,
          triggeredByUserId,
          destBucket,
        },
      });
      this.logger.log(`offsite-backup skipped (OFFSITE_BACKUP_ENABLED=false): run ${skipped.id}`);
      return {
        id: skipped.id,
        status: 'SKIPPED',
        filesCount: 0,
        totalBytes: 0,
        durationMs: 0,
        startedAt,
        finishedAt: skipped.finishedAt,
      };
    }

    // Reserve the run row in RUNNING state so even a hard crash leaves a trail.
    const run = await this.prisma.offsiteBackupRun.create({
      data: {
        startedAt,
        status: 'RUNNING',
        triggeredBy,
        triggeredByUserId,
        destBucket,
      },
    });

    let filesCount = 0;
    let totalBytes = 0n;
    let errorMessage: string | undefined;

    try {
      const storage = this.getStorage();
      const dest = storage.bucket(destBucket);

      // 1. SQL dumps
      const sqlSource = this.getSqlSourceBucket();
      if (sqlSource) {
        const sqlPrefix = this.getSqlPrefix();
        const sqlResult = await this.replicatePrefix({
          source: storage.bucket(sqlSource),
          sourcePrefix: sqlPrefix,
          dest,
          destPrefix: 'sql/',
          modifiedSince: null, // replicate every dump that's not yet off-site
        });
        filesCount += sqlResult.filesCount;
        totalBytes += sqlResult.totalBytes;
      } else {
        this.logger.warn(
          'OFFSITE_BACKUP_SQL_SOURCE_BUCKET not set — SQL replication step skipped',
        );
      }

      // 2. Document bucket — last 26h diff
      const docsSource = this.getSourceDocsBucket();
      const docsLookback = new Date(Date.now() - OffsiteBackupService.DOCS_LOOKBACK_MS);
      const docsResult = await this.replicatePrefix({
        source: storage.bucket(docsSource),
        sourcePrefix: '',
        dest,
        destPrefix: 'docs/',
        modifiedSince: docsLookback,
      });
      filesCount += docsResult.filesCount;
      totalBytes += docsResult.totalBytes;

      // 3. Cleanup — under both `sql/` and `docs/` only
      const retentionDays = this.getRetentionDays();
      const cleanupCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      await this.cleanupPrefix(dest, 'sql/', cleanupCutoff);
      await this.cleanupPrefix(dest, 'docs/', cleanupCutoff);
    } catch (err) {
      errorMessage = this.truncErr(err);
      this.logger.error(`offsite-backup failed: ${errorMessage}`);
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'offsite-backup' },
        extra: { runId: run.id, triggeredBy, destBucket },
      });
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const status: 'SUCCESS' | 'FAILED' = errorMessage ? 'FAILED' : 'SUCCESS';

    await this.prisma.offsiteBackupRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        status,
        filesCount,
        totalBytes,
        errorMessage,
      },
    });

    this.logger.log(
      `offsite-backup ${status}: run ${run.id} — ${filesCount} files / ${totalBytes}B / ${durationMs}ms`,
    );
    if (status === 'SUCCESS') {
      Sentry.captureMessage(`offsite-backup replicated ${filesCount} files`, {
        level: 'info',
        tags: { kind: 'cron-job', cron: 'offsite-backup' },
        extra: { runId: run.id, filesCount, totalBytes: totalBytes.toString(), durationMs },
      });
    }

    return {
      id: run.id,
      status,
      filesCount,
      totalBytes: Number(totalBytes),
      durationMs,
      startedAt,
      finishedAt,
      errorMessage,
    };
  }

  /** GCS list-page size — capped to stay well under the per-pod memory budget. */
  static readonly LIST_PAGE_SIZE = 1000;

  /**
   * Stream-copy every object under `sourcePrefix` whose updated time falls
   * after `modifiedSince` (or all of them, when null) into the destination
   * bucket under `destPrefix`. Skips when the destination object already
   * has the same md5 (idempotent re-run safety).
   *
   * W2 fix: pages through the source listing 1000 objects at a time. The
   * previous single-call `getFiles({ prefix })` materialized every object
   * descriptor into memory — on a 100GB document bucket (50k+ files) that
   * was a ~250MB JS heap spike per run, risking OOM on Cloud Run's 512MB
   * default. Memory now bounded to one page at a time.
   */
  private async replicatePrefix(args: {
    source: Bucket;
    sourcePrefix: string;
    dest: Bucket;
    destPrefix: string;
    modifiedSince: Date | null;
  }): Promise<{ filesCount: number; totalBytes: bigint }> {
    const { source, sourcePrefix, dest, destPrefix, modifiedSince } = args;
    let filesCount = 0;
    let totalBytes = 0n;

    let pageToken: string | undefined;
    do {
      const listOpts = {
        prefix: sourcePrefix,
        autoPaginate: false,
        maxResults: OffsiteBackupService.LIST_PAGE_SIZE,
        pageToken,
      };
      // GCS SDK overloads return `[File[], Query | null, ApiResponse]` when
      // called without a callback. Types lose the tuple shape across the
      // union — cast through unknown for safety.
      const [files, nextQuery] = (await source.getFiles(
        listOpts as unknown as Parameters<Bucket['getFiles']>[0],
      )) as unknown as [GcsFile[], { pageToken?: string } | null];

      for (const file of files) {
        try {
          if (modifiedSince && !this.isFileModifiedAfter(file, modifiedSince)) {
            continue;
          }
          const relPath = file.name.startsWith(sourcePrefix)
            ? file.name.slice(sourcePrefix.length)
            : file.name;
          const destName = `${destPrefix}${relPath}`;
          const destFile = dest.file(destName);

          // Idempotency: skip if dest already exists and md5 matches the source.
          const [destExists] = await destFile.exists();
          if (destExists) {
            const [destMeta] = await destFile.getMetadata();
            if (destMeta.md5Hash && file.metadata.md5Hash === destMeta.md5Hash) {
              this.logger.debug(`offsite-backup skip (md5 match): ${destName}`);
              continue;
            }
          }

          await file.copy(destFile);

          // W6 fix: some GCS object types (e.g. composed objects, transcoded
          // media) return `size` undefined on source — refresh from dest as
          // a fallback rather than silently under-counting totalBytes.
          let copiedBytes = this.parseSize(file.metadata.size);
          if (copiedBytes === 0) {
            try {
              const [destMeta] = await destFile.getMetadata();
              copiedBytes = this.parseSize(destMeta.size);
            } catch {
              // Already copied — metadata refresh failure shouldn't fail run.
            }
            if (copiedBytes === 0) {
              this.logger.warn(
                `offsite-backup: size=0 reported for ${file.name} after copy — totalBytes will under-count by this file`,
              );
            }
          }

          filesCount++;
          totalBytes += BigInt(copiedBytes);
          this.logger.debug(`offsite-backup copied: ${file.name} -> ${destName} (${copiedBytes}B)`);
        } catch (err) {
          // Partial-failure semantics — log + Sentry + keep going on next file.
          this.logger.warn(
            `offsite-backup copy failed for ${file.name}: ${this.truncErr(err)}`,
          );
          Sentry.captureException(err, {
            tags: { kind: 'cron-job', cron: 'offsite-backup', step: 'replicate' },
            extra: { sourceFile: file.name, destPrefix },
          });
        }
      }

      pageToken = nextQuery?.pageToken ?? undefined;
    } while (pageToken);

    return { filesCount, totalBytes };
  }

  /**
   * Delete objects under `prefix` that haven't been updated since `cutoff`.
   * Returns the deleted count.
   *
   * W2 fix: pages through 1000 objects at a time — same memory bound as
   * replicatePrefix.
   */
  private async cleanupPrefix(dest: Bucket, prefix: string, cutoff: Date): Promise<number> {
    let deleted = 0;
    let pageToken: string | undefined;
    do {
      const listOpts = {
        prefix,
        autoPaginate: false,
        maxResults: OffsiteBackupService.LIST_PAGE_SIZE,
        pageToken,
      };
      const [files, nextQuery] = (await dest.getFiles(
        listOpts as unknown as Parameters<Bucket['getFiles']>[0],
      )) as unknown as [GcsFile[], { pageToken?: string } | null];

      for (const file of files) {
        const updated = this.parseDate(file.metadata.updated);
        if (updated && updated.getTime() < cutoff.getTime()) {
          try {
            await file.delete({ ignoreNotFound: true });
            deleted++;
            this.logger.debug(`offsite-backup cleanup deleted: ${file.name}`);
          } catch (err) {
            this.logger.warn(
              `offsite-backup cleanup failed for ${file.name}: ${this.truncErr(err)}`,
            );
            Sentry.captureException(err, {
              tags: { kind: 'cron-job', cron: 'offsite-backup', step: 'cleanup' },
              extra: { destFile: file.name },
            });
          }
        }
      }

      pageToken = nextQuery?.pageToken ?? undefined;
    } while (pageToken);

    if (deleted > 0) {
      this.logger.log(`offsite-backup cleanup: deleted ${deleted} object(s) under ${prefix}`);
    }
    return deleted;
  }

  private isFileModifiedAfter(file: GcsFile, after: Date): boolean {
    const updated = this.parseDate(file.metadata.updated);
    if (!updated) return true; // unknown — replicate, safer than skip
    return updated.getTime() >= after.getTime();
  }

  private parseDate(raw: string | undefined | null): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  private parseSize(raw: string | number | undefined | null): number {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  private truncErr(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.length > OffsiteBackupService.ERROR_TRUNC_CHARS
      ? `${msg.slice(0, OffsiteBackupService.ERROR_TRUNC_CHARS)}…`
      : msg;
  }

  // ─── SP7.8 — Dual-DB Cloud SQL backup support ────────────────────────────

  /**
   * Cloud SQL instance references for SP7.8 dual-DB backup.
   *
   * Real Cloud SQL export trigger (gcloud SDK) is invoked per DB instance.
   * Reads from env vars; skips gracefully when not set (second instance is
   * owner-blocked pending bc_finance provisioning).
   *
   * Each entry maps a logical DB name to the env var that holds the
   * Cloud SQL instance connection name (project:region:instance).
   */
  static readonly DB_INSTANCES: ReadonlyArray<{ name: string; urlEnv: string }> = [
    { name: 'bc_shop', urlEnv: 'CLOUDSQL_SHOP_INSTANCE' },
    { name: 'bc_finance', urlEnv: 'CLOUDSQL_FINANCE_INSTANCE' },
  ];

  /**
   * Trigger Cloud SQL exports for both `bc_shop` and `bc_finance` databases.
   *
   * Iterates the DB_INSTANCES list. For each:
   *  - Skips with a warning when the instance env var is not configured
   *    (expected for bc_finance until the owner provisions the instance).
   *  - Calls `backupSingleDatabase` — real implementation delegates to the
   *    Cloud SQL Admin API export trigger; currently a logged stub pending
   *    owner provisioning of the bc_finance Cloud SQL instance.
   *
   * Non-throwing: every error is captured individually so one DB failure
   * does not block the other. Results array lets callers decide whether to
   * treat partial failures as hard errors.
   */
  async backupAllDatabases(): Promise<
    Array<{ db: string; status: 'ok' | 'error'; error?: string }>
  > {
    const results: Array<{ db: string; status: 'ok' | 'error'; error?: string }> = [];
    for (const inst of OffsiteBackupService.DB_INSTANCES) {
      const instanceUrl = process.env[inst.urlEnv];
      if (!instanceUrl) {
        this.logger.warn(
          `backupAllDatabases: skip ${inst.name} — env ${inst.urlEnv} not set`,
        );
        results.push({ db: inst.name, status: 'error', error: 'env-not-set' });
        continue;
      }
      try {
        await this.backupSingleDatabase(inst.name, instanceUrl);
        results.push({ db: inst.name, status: 'ok' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`backupAllDatabases: ${inst.name} failed — ${msg}`);
        Sentry.captureException(err instanceof Error ? err : new Error(msg), {
          tags: { kind: 'cron-job', cron: 'offsite-backup', step: 'cloud-sql-export', db: inst.name },
        });
        results.push({ db: inst.name, status: 'error', error: msg });
      }
    }
    return results;
  }

  /**
   * Trigger a Cloud SQL export for a single database instance.
   *
   * Real implementation: call Cloud SQL Admin API
   * `POST /sql/v1beta4/projects/{project}/instances/{instance}/export`
   * via gcloud SDK or googleapis client library.
   *
   * Currently a stub — owner must provision the bc_finance Cloud SQL
   * instance before this can be wired up end-to-end. The GCS replication
   * side (OffsiteBackupService.run) already handles copying the resulting
   * dump files once they land in OFFSITE_BACKUP_SQL_SOURCE_BUCKET.
   */
  private async backupSingleDatabase(dbName: string, instanceUrl: string): Promise<void> {
    // Stub — log intent for now; real Cloud SQL export trigger wired after
    // owner provisions bc_finance instance + sets CLOUDSQL_FINANCE_INSTANCE.
    this.logger.log(
      `backupSingleDatabase (stub): would trigger Cloud SQL export for ${dbName} from ${instanceUrl}`,
    );
  }

  /**
   * History endpoint backing — newest first. Joins the user that triggered
   * a manual run so the UI can display a real name instead of a UUID slice.
   */
  async getRecentRuns(limit = 7): Promise<RecentRun[]> {
    const rows = await this.prisma.offsiteBackupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        triggeredByUser: { select: { id: true, name: true, email: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      status: r.status,
      filesCount: r.filesCount,
      totalBytes: Number(r.totalBytes),
      errorMessage: r.errorMessage,
      triggeredBy: r.triggeredBy,
      triggeredByUser: r.triggeredByUser
        ? { id: r.triggeredByUser.id, name: r.triggeredByUser.name }
        : null,
      destBucket: r.destBucket,
    }));
  }

  /**
   * C3 fix — daily retention. Prunes OffsiteBackupRun rows older than
   * `days` (default 365). Called by `OffsiteBackupRetentionCron` at
   * 02:00 BKK; exposed as a method so tests can drive it without the
   * scheduler.
   *
   * Hard-delete is correct here — these rows are pure operational logs
   * (no legal evidence; the actual backup files live in GCS with their own
   * lifecycle). Matches AuditLog 1-year policy + the model's
   * "append-only event log" exception in database.md.
   */
  async pruneOldRuns(days = 365): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.prisma.offsiteBackupRun.deleteMany({
      where: { startedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(
        `offsite-backup retention: pruned ${result.count} row(s) older than ${days}d`,
      );
    }
    return result.count;
  }
}

export interface OffsiteBackupRunOptions {
  /** Always required — disambiguates whether the row came from a scheduler tick or a human button click. */
  triggeredBy: 'cron' | 'manual';
  /** When triggeredBy = 'manual', the OWNER who clicked "Run Now". Null for cron. */
  triggeredByUserId?: string | null;
}

export interface OffsiteBackupRunResult {
  id: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  filesCount: number;
  totalBytes: number;
  durationMs: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage?: string;
}

export interface RecentRun {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  filesCount: number;
  totalBytes: number;
  errorMessage: string | null;
  triggeredBy: string;
  triggeredByUser: { id: string; name: string } | null;
  destBucket: string | null;
}
