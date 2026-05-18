import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as os from 'os';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { encryptPII, isEncrypted } from '../../utils/crypto.util';
import { hashPII, encryptReferencesJson } from '../../utils/pii.util';

/**
 * Phase 3 SP4 — PDPA strict-mode + backfill orchestrator.
 *
 * Distinct from the existing PDPAService (which handles consent + DSAR
 * lifecycle). This service owns three things:
 *
 *   1. Status — count plaintext vs encrypted customers + report strict-mode flag
 *      (powers /settings#pdpa status card).
 *   2. Toggle — flip the SystemConfig PDPA_STRICT_MODE flag (OWNER only). When
 *      flipping to STRICT, refuses if plaintext rows still exist.
 *   3. Backfill — encrypt + hash any row whose *Encrypted columns are NULL.
 *      Both the CLI and the UI "Run Backfill" button route through this same
 *      runBackfill() method so the logic + audit trail (PdpaBackfillRun row)
 *      are identical.
 *
 * Hard rule: **NEVER log decrypted PII**. The only logger calls here describe
 * batch counts + error class names, never row content.
 */

export interface RunBackfillOptions {
  triggeredBy: 'cli' | 'manual';
  triggeredByUserId?: string | null;
  /** How many Customer rows per batch — 100 is a safe default that
   *  doesn't blow the encrypt CPU budget or hold long row locks. */
  batchSize?: number;
  /** On-progress callback for the CLI — emits per-batch progress so the
   *  user sees output instead of staring at a blank terminal. */
  onProgress?: (p: BackfillProgress) => void;
}

export interface BackfillProgress {
  processed: number;
  skipped: number;
  total: number;
  batchNumber: number;
}

export interface BackfillResult {
  id: string;
  status: 'COMPLETED' | 'FAILED';
  totalRecords: number;
  processedRecords: number;
  skippedRecords: number;
  durationMs: number;
  errorMessage?: string;
}

export interface PdpaStatus {
  strictMode: boolean;
  totalCustomers: number;
  encryptedCount: number;
  plaintextCount: number;
  /** Whether every existing Customer row has been backfilled. Equivalent
   *  to `plaintextCount === 0`. */
  readyForStrictMode: boolean;
  encryptionKeyConfigured: boolean;
  hashSaltConfigured: boolean;
}

@Injectable()
export class PdpaEncryptionService {
  private readonly logger = new Logger(PdpaEncryptionService.name);
  /** PostgreSQL advisory-lock key — guards against two simultaneous backfill
   *  runs (CLI + UI button + cron all in the same minute). */
  static readonly ADVISORY_LOCK_KEY = 'pdpa-backfill';
  /** Default batch size. Each batch encrypts ~12 columns × 100 rows ≈ 1.2k
   *  AES operations, comfortably under 100ms on a Cloud Run cpu. */
  static readonly DEFAULT_BATCH_SIZE = 100;
  /** Truncate cap on error message column (matches OffsiteBackupRun pattern). */
  static readonly ERROR_TRUNC_CHARS = 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly piiService: CustomerPiiService,
  ) {}

  // ---------------------------------------------------------------------------
  // Status + toggle
  // ---------------------------------------------------------------------------

  /**
   * Returns the strict-mode flag + plaintext/encrypted counts. Used by the
   * /settings#pdpa header card AND by the backfill UI as the "do we need
   * to keep going?" check.
   *
   * Counts use the simple approach: any Customer row whose nationalId is
   * present but nationalIdEncrypted is NULL is "still plaintext". Rows
   * where nationalId itself is empty (legacy data anomaly) are excluded —
   * nothing to encrypt.
   */
  async getStatus(): Promise<PdpaStatus> {
    const [strictMode, totalCustomers, plaintextCount] = await Promise.all([
      this.piiService.isStrictMode(),
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.customer.count({
        where: {
          deletedAt: null,
          AND: [
            { nationalId: { not: '' } },
            { nationalIdEncrypted: null },
          ],
        },
      }),
    ]);

    const encryptedCount = Math.max(0, totalCustomers - plaintextCount);

    return {
      strictMode,
      totalCustomers,
      encryptedCount,
      plaintextCount,
      readyForStrictMode: plaintextCount === 0,
      encryptionKeyConfigured: !!process.env.PII_ENCRYPTION_KEY,
      hashSaltConfigured: !!process.env.PII_HASH_SALT,
    };
  }

  /**
   * Flip the strict-mode flag. Rejects turning STRICT on while plaintext
   * rows still exist — otherwise the very first read would 400 with
   * "ข้อมูลยังไม่ได้เข้ารหัส" for all those rows.
   */
  async setStrictMode(enabled: boolean): Promise<{ strictMode: boolean }> {
    if (enabled) {
      const status = await this.getStatus();
      if (!status.encryptionKeyConfigured || !status.hashSaltConfigured) {
        throw new BadRequestException(
          'PII_ENCRYPTION_KEY / PII_HASH_SALT ยังไม่ได้ตั้งค่า — กรุณาตั้ง env vars ก่อนเปิด strict mode',
        );
      }
      if (status.plaintextCount > 0) {
        throw new BadRequestException(
          `ยังมีลูกค้า ${status.plaintextCount} คนที่ยังไม่ได้เข้ารหัส — กรุณารัน Backfill ก่อนเปิด strict mode`,
        );
      }
    }
    await this.piiService.setStrictMode(enabled);
    return { strictMode: enabled };
  }

  // ---------------------------------------------------------------------------
  // Backfill orchestration
  // ---------------------------------------------------------------------------

  /**
   * Look up a backfill run by id — used by the UI's status polling.
   */
  async getRun(id: string) {
    const run = await this.prisma.pdpaBackfillRun.findUnique({
      where: { id },
      include: {
        triggeredByUser: { select: { id: true, name: true } },
      },
    });
    if (!run) throw new NotFoundException('ไม่พบประวัติ Backfill');
    return run;
  }

  /** Recent runs for the history panel. */
  async getRecentRuns(limit = 7) {
    return this.prisma.pdpaBackfillRun.findMany({
      take: limit,
      orderBy: { startedAt: 'desc' },
      include: {
        triggeredByUser: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Main backfill loop. Encrypts + hashes Customer rows in batches.
   *
   * Idempotent: skips rows where every PII field already has a non-null
   * encrypted column. Safe to re-run after a partial-failure crash —
   * progress is committed per batch, so a re-run resumes from the
   * unencrypted tail.
   *
   * @throws ConflictException when another backfill run already holds the lock.
   */
  async runBackfill(opts: RunBackfillOptions): Promise<BackfillResult> {
    const { triggeredBy, triggeredByUserId = null } = opts;
    const batchSize = opts.batchSize ?? PdpaEncryptionService.DEFAULT_BATCH_SIZE;

    if (!process.env.PII_ENCRYPTION_KEY || !process.env.PII_HASH_SALT) {
      throw new BadRequestException(
        'PII_ENCRYPTION_KEY และ PII_HASH_SALT ต้องตั้งค่าก่อนรัน Backfill',
      );
    }

    const lockResult = await this.prisma.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${PdpaEncryptionService.ADVISORY_LOCK_KEY})) AS acquired
    `;
    if (!lockResult[0]?.acquired) {
      this.logger.warn(`pdpa-backfill: advisory lock already held — refusing concurrent run (triggeredBy=${triggeredBy})`);
      throw new ConflictException('มี Backfill ทำงานอยู่ — กรุณารอจนเสร็จ');
    }

    try {
      return await this.runUnderLock({ triggeredBy, triggeredByUserId, batchSize, onProgress: opts.onProgress });
    } finally {
      try {
        await this.prisma.$queryRaw`
          SELECT pg_advisory_unlock(hashtext(${PdpaEncryptionService.ADVISORY_LOCK_KEY}))
        `;
      } catch (err) {
        this.logger.warn(`pdpa-backfill: advisory unlock failed: ${this.truncErr(err)}`);
      }
    }
  }

  private async runUnderLock(opts: {
    triggeredBy: 'cli' | 'manual';
    triggeredByUserId: string | null;
    batchSize: number;
    onProgress?: (p: BackfillProgress) => void;
  }): Promise<BackfillResult> {
    const { triggeredBy, triggeredByUserId, batchSize, onProgress } = opts;
    const startedAt = new Date();

    const totalRecords = await this.prisma.customer.count({
      where: {
        deletedAt: null,
        AND: [
          { nationalId: { not: '' } },
          { nationalIdEncrypted: null },
        ],
      },
    });

    const run = await this.prisma.pdpaBackfillRun.create({
      data: {
        startedAt,
        status: 'RUNNING',
        triggeredBy,
        triggeredByUserId,
        totalRecords,
        hostname: this.safeHostname(),
      },
    });

    let processedRecords = 0;
    let skippedRecords = 0;
    let errorMessage: string | undefined;
    let batchNumber = 0;

    try {
      let cursorId: string | null = null;

      // Hard upper bound on iteration count prevents an infinite loop in
      // the impossible-but-defensive case where the cursor stops
      // advancing (e.g. concurrent writer adds rows faster than we
      // process them).
      const MAX_ITERATIONS = 10_000;
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const batch = (await this.prisma.customer.findMany({
          where: {
            deletedAt: null,
            AND: [
              { nationalId: { not: '' } },
              { nationalIdEncrypted: null },
            ],
          },
          take: batchSize,
          ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
          orderBy: { id: 'asc' },
        })) as unknown as Array<Record<string, unknown>>;

        if (batch.length === 0) break;
        cursorId = batch[batch.length - 1].id as string;
        batchNumber++;

        const { processed, skipped } = await this.processBatch(batch);
        processedRecords += processed;
        skippedRecords += skipped;

        await this.prisma.pdpaBackfillRun.update({
          where: { id: run.id },
          data: { processedRecords, skippedRecords },
        });

        if (onProgress) {
          onProgress({
            processed: processedRecords,
            skipped: skippedRecords,
            total: totalRecords,
            batchNumber,
          });
        }
      }

      const finishedAt = new Date();
      await this.prisma.pdpaBackfillRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETED', finishedAt, processedRecords, skippedRecords },
      });

      return {
        id: run.id,
        status: 'COMPLETED',
        totalRecords,
        processedRecords,
        skippedRecords,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
    } catch (err) {
      errorMessage = this.truncErr(err);
      Sentry.captureException(err, {
        tags: { module: 'pdpa', op: 'backfill' },
        extra: { runId: run.id, batchNumber, processedRecords, skippedRecords },
      });
      this.logger.error(`pdpa-backfill: failed at batch ${batchNumber}: ${errorMessage}`);

      const finishedAt = new Date();
      await this.prisma.pdpaBackfillRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt, errorMessage, processedRecords, skippedRecords },
      });

      return {
        id: run.id,
        status: 'FAILED',
        totalRecords,
        processedRecords,
        skippedRecords,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage,
      };
    }
  }

  /**
   * Encrypt + hash a single batch. Per-row failures are swallowed (logged
   * at warn level, NO PII) so one bad row doesn't halt the whole backfill.
   * Such rows show up as "skipped" in the result.
   */
  private async processBatch(batch: Array<Record<string, unknown>>): Promise<{
    processed: number;
    skipped: number;
  }> {
    let processed = 0;
    let skipped = 0;
    const key = process.env.PII_ENCRYPTION_KEY!;
    const salt = process.env.PII_HASH_SALT!;

    for (const row of batch) {
      try {
        const encrypted: Record<string, unknown> = {};
        const enc = (v: unknown): string | null => {
          if (typeof v !== 'string' || !v) return null;
          if (isEncrypted(v)) return v;
          return encryptPII(v, key);
        };
        const hsh = (v: unknown): string | null => {
          if (typeof v !== 'string' || !v) return null;
          return hashPII(v, salt);
        };

        const fieldPairs: Array<[plain: string, encField: string, hashField?: string]> = [
          ['nationalId', 'nationalIdEncrypted', 'nationalIdHash'],
          ['phone', 'phoneEncrypted', 'phoneHash'],
          ['phoneSecondary', 'phoneSecondaryEncrypted'],
          ['email', 'emailEncrypted'],
          ['addressIdCard', 'addressIdCardEncrypted'],
          ['addressCurrent', 'addressCurrentEncrypted'],
          ['addressWork', 'addressWorkEncrypted'],
          ['guardianNationalId', 'guardianNationalIdEncrypted'],
          ['guardianPhone', 'guardianPhoneEncrypted'],
          ['guardianAddress', 'guardianAddressEncrypted'],
        ];

        let touched = false;
        for (const [plain, encField, hashField] of fieldPairs) {
          if (row[encField] == null) {
            const encVal = enc(row[plain]);
            if (encVal !== null) {
              encrypted[encField] = encVal;
              touched = true;
            }
            if (hashField && row[hashField] == null) {
              const hashVal = hsh(row[plain]);
              if (hashVal !== null) {
                encrypted[hashField] = hashVal;
              }
            }
          }
        }

        if (
          row['referencesEncrypted'] == null &&
          Array.isArray(row['references']) &&
          (row['references'] as unknown[]).length > 0
        ) {
          encrypted['referencesEncrypted'] = encryptReferencesJson(row['references'], key);
          touched = true;
        }

        if (!touched) {
          skipped++;
          continue;
        }

        await this.prisma.customer.update({
          where: { id: row['id'] as string },
          data: encrypted as Prisma.CustomerUpdateInput,
        });
        processed++;
      } catch (err) {
        // P2002 unique-constraint on nationalIdHash means there's a
        // soft-deleted ghost with the same plaintext nationalId —
        // leave it for the operator to reconcile manually.
        skipped++;
        this.logger.warn(
          `pdpa-backfill: skipping customer (id-suffix=${this.idTail(row['id'])}) — ${this.errClass(err)}`,
        );
      }
    }

    return { processed, skipped };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private truncErr(err: unknown): string {
    const msg = (err as { message?: string })?.message ?? String(err);
    return msg.length > PdpaEncryptionService.ERROR_TRUNC_CHARS
      ? msg.slice(0, PdpaEncryptionService.ERROR_TRUNC_CHARS) + '…'
      : msg;
  }

  /** Last 8 chars of the row UUID — enough for ops to grep, no PII. */
  private idTail(id: unknown): string {
    return typeof id === 'string' ? id.slice(-8) : 'unknown';
  }

  private errClass(err: unknown): string {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      return String((err as { code: unknown }).code);
    }
    if (err instanceof Error) return err.constructor.name;
    return 'Unknown';
  }

  private safeHostname(): string {
    try {
      return os.hostname();
    } catch {
      return 'unknown';
    }
  }
}
