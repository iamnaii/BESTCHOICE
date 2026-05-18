import { Injectable, Logger } from '@nestjs/common';
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
   */
  async setEnabled(enabled: boolean): Promise<boolean> {
    await this.prisma.systemConfig.upsert({
      where: { key: 'OFFSITE_BACKUP_ENABLED' },
      update: { value: enabled ? 'true' : 'false', updatedAt: new Date() },
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
   * Main entry point — runs the full replication cycle and writes a
   * RunOffsiteBackupResult to OffsiteBackupRun.
   *
   * `triggeredBy` is stored on the run row for forensics. Pass 'cron' from
   * the scheduler, 'manual' / userId from the controller.
   */
  async run(triggeredBy: string): Promise<OffsiteBackupRunResult> {
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

  /**
   * Stream-copy every object under `sourcePrefix` whose updated time falls
   * after `modifiedSince` (or all of them, when null) into the destination
   * bucket under `destPrefix`. Skips when the destination object already
   * has the same md5 (idempotent re-run safety).
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

    const [files] = await source.getFiles({ prefix: sourcePrefix });
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
        const size = this.parseSize(file.metadata.size);
        filesCount++;
        totalBytes += BigInt(size);
        this.logger.debug(`offsite-backup copied: ${file.name} -> ${destName} (${size}B)`);
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

    return { filesCount, totalBytes };
  }

  /**
   * Delete objects under `prefix` that haven't been updated since `cutoff`.
   * Returns the deleted count.
   */
  private async cleanupPrefix(dest: Bucket, prefix: string, cutoff: Date): Promise<number> {
    const [files] = await dest.getFiles({ prefix });
    let deleted = 0;
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

  /**
   * History endpoint backing — newest first.
   */
  async getRecentRuns(limit = 7): Promise<RecentRun[]> {
    const rows = await this.prisma.offsiteBackupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
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
      destBucket: r.destBucket,
    }));
  }
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
  triggeredBy: string | null;
  destBucket: string | null;
}
