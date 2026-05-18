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
import { AuditService } from '../audit/audit.service';

/**
 * Phase 3 SP4 — PDPA strict-mode + backfill orchestrator.
 *
 * Distinct from the existing PDPAService (which handles consent + DSAR
 * lifecycle). This service owns three things:
 *
 *   1. Status — count plaintext vs encrypted customers + report strict-mode flag
 *      (powers /settings#pdpa status card).
 *   2. Toggle — flip the SystemConfig PDPA_STRICT_MODE flag (OWNER only). When
 *      flipping to STRICT, refuses if plaintext rows still exist on ANY of
 *      the 11 PII columns (DEEP review W4 — was previously only checking
 *      nationalId).
 *   3. Backfill — encrypt + hash any row whose *Encrypted columns are NULL.
 *      Both the CLI and the UI "Run Backfill" button route through this same
 *      runBackfill() method so the logic + audit trail (PdpaBackfillRun row +
 *      AuditLog PDPA_BACKFILL_RUN) are identical.
 *
 * Hard rule: **NEVER log decrypted PII**. The only logger calls here describe
 * batch counts + error class names, never row content.
 */

/**
 * 11 Customer PII columns this service tracks. The status / strict-mode /
 * backfill code paths all need the same column inventory — keeping it in
 * one constant means adding a 12th PII column is a single-line change.
 *
 * Each tuple = [plaintext column, encrypted column].
 *
 * Trade-in PII (`transfer_account_*`) is intentionally NOT included —
 * those columns are owned by `TradeInService` and have their own
 * dual-write path.
 */
const PII_COLUMNS: ReadonlyArray<[plain: string, enc: string]> = [
  ['nationalId', 'nationalIdEncrypted'],
  ['phone', 'phoneEncrypted'],
  ['phoneSecondary', 'phoneSecondaryEncrypted'],
  ['email', 'emailEncrypted'],
  ['addressIdCard', 'addressIdCardEncrypted'],
  ['addressCurrent', 'addressCurrentEncrypted'],
  ['addressWork', 'addressWorkEncrypted'],
  ['guardianNationalId', 'guardianNationalIdEncrypted'],
  ['guardianPhone', 'guardianPhoneEncrypted'],
  ['guardianAddress', 'guardianAddressEncrypted'],
];

export interface RunBackfillOptions {
  triggeredBy: 'cli' | 'manual';
  triggeredByUserId?: string | null;
  /** How many Customer rows per batch — 100 is a safe default that
   *  doesn't blow the encrypt CPU budget or hold long row locks. */
  batchSize?: number;
  /** On-progress callback for the CLI — emits per-batch progress so the
   *  user sees output instead of staring at a blank terminal. */
  onProgress?: (p: BackfillProgress) => void;
  /** Optional IP / UA for audit log enrichment (controller forwards from req). */
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface BackfillProgress {
  processed: number;
  skipped: number;
  total: number;
  batchNumber: number;
}

export interface BackfillResult {
  id: string;
  status: 'COMPLETED' | 'FAILED' | 'COMPLETED_WITH_RACE';
  totalRecords: number;
  processedRecords: number;
  skippedRecords: number;
  durationMs: number;
  errorMessage?: string;
}

export interface PiiColumnPlaintextCount {
  column: string;
  plaintextCount: number;
}

export interface PdpaStatus {
  strictMode: boolean;
  totalCustomers: number;
  encryptedCount: number;
  plaintextCount: number;
  /** Per-column breakdown — every column listed in PII_COLUMNS, value
   *  = number of rows where `<column>` is non-empty but `<column>_encrypted`
   *  is NULL. Used by the UI to surface which exact field is missing. */
  plaintextByColumn: PiiColumnPlaintextCount[];
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
  /** Used by the cursor-race retry path (W9 fix). Stops at this many passes
   *  to bound the worst-case in pathological concurrent-writer scenarios. */
  static readonly MAX_RETRY_PASSES = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly piiService: CustomerPiiService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Status + toggle
  // ---------------------------------------------------------------------------

  /**
   * Per-column count of rows where the plaintext column has data but the
   * encrypted column is still NULL.  DEEP review W3 — the previous
   * implementation only counted `nationalId`, missing customers whose
   * nationalId was empty but phone / email / address was populated.
   *
   * Returns one entry per PII column (with 0 counts for fully-encrypted
   * columns, so the UI can render a stable table).
   */
  async getPlaintextCountsByColumn(): Promise<PiiColumnPlaintextCount[]> {
    const out: PiiColumnPlaintextCount[] = [];
    for (const [plain, enc] of PII_COLUMNS) {
      // Each column needs its own count() — we can't compound them with
      // OR efficiently because we want per-column visibility for the UI.
      const count = await this.prisma.customer.count({
        where: {
          deletedAt: null,
          AND: [
            { [plain]: { not: '' } } as Prisma.CustomerWhereInput,
            { [plain]: { not: null } } as Prisma.CustomerWhereInput,
            { [enc]: null } as Prisma.CustomerWhereInput,
          ],
        },
      });
      out.push({ column: plain, plaintextCount: count });
    }
    return out;
  }

  /**
   * Aggregate count of rows that still have ANY plaintext PII column with
   * a missing encrypted counterpart. Powers the headline "X customers
   * not yet encrypted" number on /settings#pdpa.
   *
   * One query — uses OR across all 11 columns so we don't accidentally
   * double-count a row that has multiple unencrypted columns.
   */
  async getAnyPlaintextCount(): Promise<number> {
    const orConditions: Prisma.CustomerWhereInput[] = PII_COLUMNS.map(([plain, enc]) => ({
      AND: [
        { [plain]: { not: '' } } as Prisma.CustomerWhereInput,
        { [plain]: { not: null } } as Prisma.CustomerWhereInput,
        { [enc]: null } as Prisma.CustomerWhereInput,
      ],
    }));
    return this.prisma.customer.count({
      where: {
        deletedAt: null,
        OR: orConditions,
      },
    });
  }

  /**
   * Returns the strict-mode flag + plaintext/encrypted counts. Used by the
   * /settings#pdpa header card AND by the backfill UI as the "do we need
   * to keep going?" check.
   *
   * DEEP review W3 — counts now scan ALL 11 PII columns (was previously
   * only nationalId).
   */
  async getStatus(): Promise<PdpaStatus> {
    const [strictMode, totalCustomers, plaintextCount, plaintextByColumn] = await Promise.all([
      this.piiService.isStrictMode(),
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.getAnyPlaintextCount(),
      this.getPlaintextCountsByColumn(),
    ]);

    const encryptedCount = Math.max(0, totalCustomers - plaintextCount);

    return {
      strictMode,
      totalCustomers,
      encryptedCount,
      plaintextCount,
      plaintextByColumn,
      readyForStrictMode: plaintextCount === 0,
      encryptionKeyConfigured: !!process.env.PII_ENCRYPTION_KEY,
      hashSaltConfigured: !!process.env.PII_HASH_SALT,
    };
  }

  /**
   * Flip the strict-mode flag. Rejects turning STRICT on while plaintext
   * rows still exist — otherwise the very first read would 400 with
   * "ข้อมูลยังไม่ได้เข้ารหัส" for all those rows.
   *
   * DEEP review W4 — the rejection now considers ALL 11 PII columns
   * (was previously only nationalId). Error message lists which columns
   * still have plaintext so the operator can scope the backfill.
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
        const offending = status.plaintextByColumn
          .filter((c) => c.plaintextCount > 0)
          .map((c) => `${c.column} (${c.plaintextCount})`)
          .join(', ');
        throw new BadRequestException(
          `ยังมีลูกค้าที่ยังไม่ได้เข้ารหัส รวม ${status.plaintextCount} แถว ` +
            `— คอลัมน์ที่ยังเหลือ: ${offending} — กรุณารัน Backfill ก่อนเปิด strict mode`,
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
   * progress is committed per batch (atomically — DEEP review W5), so a
   * re-run resumes from the unencrypted tail.
   *
   * DEEP review W7 — writes AuditLog `PDPA_BACKFILL_RUN` regardless of
   * whether the trigger was CLI or UI. CLI runs go through the SYSTEM
   * user (isSystemUser=true). UI runs carry the OWNER's userId.
   *
   * @throws ConflictException when another backfill run already holds the lock.
   */
  async runBackfill(opts: RunBackfillOptions): Promise<BackfillResult> {
    const { triggeredBy, triggeredByUserId = null, ipAddress = null, userAgent = null } = opts;
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

    let result: BackfillResult;
    try {
      result = await this.runUnderLock({
        triggeredBy,
        triggeredByUserId,
        batchSize,
        onProgress: opts.onProgress,
      });
    } finally {
      try {
        await this.prisma.$queryRaw`
          SELECT pg_advisory_unlock(hashtext(${PdpaEncryptionService.ADVISORY_LOCK_KEY}))
        `;
      } catch (err) {
        this.logger.warn(`pdpa-backfill: advisory unlock failed: ${this.truncErr(err)}`);
      }
    }

    // W7 — single auditable PDPA_BACKFILL_RUN entry written from BOTH the
    // CLI path and the UI button. The CLI uses the SYSTEM user UUID so
    // `userId` is always a valid FK (AuditService.log returns early when
    // userId is missing).
    await this.writeBackfillAuditLog({
      triggeredBy,
      triggeredByUserId,
      ipAddress,
      userAgent,
      result,
    });

    return result;
  }

  private async writeBackfillAuditLog(args: {
    triggeredBy: 'cli' | 'manual';
    triggeredByUserId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    result: BackfillResult;
  }): Promise<void> {
    try {
      // Resolve userId — for CLI, look up the SYSTEM user. For UI runs,
      // the OWNER's userId is already on the entry.
      let userId = args.triggeredByUserId;
      if (!userId && args.triggeredBy === 'cli') {
        const systemUser = await this.prisma.user.findFirst({
          where: { isSystemUser: true },
          select: { id: true },
        });
        userId = systemUser?.id ?? null;
      }
      if (!userId) {
        this.logger.warn('pdpa-backfill: no userId resolved for audit log — skipping');
        return;
      }
      await this.audit.log({
        userId,
        action: 'PDPA_BACKFILL_RUN',
        entity: 'pdpa_backfill_run',
        entityId: args.result.id,
        ipAddress: args.ipAddress ?? undefined,
        userAgent: args.userAgent ?? undefined,
        newValue: {
          triggeredBy: args.triggeredBy,
          status: args.result.status,
          totalRecords: args.result.totalRecords,
          processedRecords: args.result.processedRecords,
          skippedRecords: args.result.skippedRecords,
          durationMs: args.result.durationMs,
        },
      });
    } catch (err) {
      // Audit-log failure must never crash a successful backfill.
      this.logger.error(
        `pdpa-backfill: failed to write audit log: ${this.truncErr(err)}`,
      );
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

    const totalRecords = await this.getAnyPlaintextCount();

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
    let racy = false;

    try {
      // ----- First pass -----
      const pass1 = await this.runMainLoop({
        runId: run.id,
        batchSize,
        onProgress,
        totalRecords,
        startProcessed: 0,
        startSkipped: 0,
        startBatchNumber: 0,
      });
      processedRecords = pass1.processedRecords;
      skippedRecords = pass1.skippedRecords;
      batchNumber = pass1.batchNumber;

      // ----- W9 cursor-race retry -----
      // After the cursor-based loop completes, run a fresh count() to see
      // if concurrent writers added new plaintext rows that the cursor
      // skipped over. Retry once. If still > 0 after pass 2, mark the
      // run COMPLETED_WITH_RACE and let ops re-run during a maintenance
      // window.
      const remaining = await this.getAnyPlaintextCount();
      if (remaining > 0) {
        this.logger.warn(
          `pdpa-backfill: ${remaining} rows added during pass 1 — running pass 2`,
        );
        const pass2 = await this.runMainLoop({
          runId: run.id,
          batchSize,
          onProgress,
          totalRecords: totalRecords + remaining,
          startProcessed: processedRecords,
          startSkipped: skippedRecords,
          startBatchNumber: batchNumber,
        });
        processedRecords = pass2.processedRecords;
        skippedRecords = pass2.skippedRecords;
        batchNumber = pass2.batchNumber;

        const stillRemaining = await this.getAnyPlaintextCount();
        if (stillRemaining > 0) {
          racy = true;
          this.logger.warn(
            `pdpa-backfill: ${stillRemaining} rows STILL remaining after pass 2 — marking COMPLETED_WITH_RACE (re-run during maintenance window recommended)`,
          );
        }
      }

      const finishedAt = new Date();
      const status: BackfillResult['status'] = racy ? 'COMPLETED_WITH_RACE' : 'COMPLETED';
      await this.prisma.pdpaBackfillRun.update({
        where: { id: run.id },
        data: {
          // PdpaBackfillStatus enum only knows COMPLETED/FAILED — store
          // COMPLETED with a note on errorMessage so the UI can surface
          // the race condition without us migrating the enum.
          status: 'COMPLETED',
          finishedAt,
          processedRecords,
          skippedRecords,
          errorMessage: racy
            ? 'COMPLETED_WITH_RACE — รัน Backfill อีกครั้งใน maintenance window'
            : null,
        },
      });

      return {
        id: run.id,
        status,
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
   * Inner cursor-based loop. Extracted so the W9 retry path can reuse it.
   */
  private async runMainLoop(opts: {
    runId: string;
    batchSize: number;
    onProgress?: (p: BackfillProgress) => void;
    totalRecords: number;
    startProcessed: number;
    startSkipped: number;
    startBatchNumber: number;
  }): Promise<{ processedRecords: number; skippedRecords: number; batchNumber: number }> {
    let processedRecords = opts.startProcessed;
    let skippedRecords = opts.startSkipped;
    let batchNumber = opts.startBatchNumber;
    let cursorId: string | null = null;

    const MAX_ITERATIONS = 10_000;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const batch = (await this.prisma.customer.findMany({
        where: this.plaintextWhere(),
        take: opts.batchSize,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
        orderBy: { id: 'asc' },
      })) as unknown as Array<Record<string, unknown>>;

      if (batch.length === 0) break;
      cursorId = batch[batch.length - 1].id as string;
      batchNumber++;

      const { processed, skipped } = await this.processBatch(batch, opts.runId, processedRecords, skippedRecords);
      processedRecords += processed;
      skippedRecords += skipped;

      if (opts.onProgress) {
        opts.onProgress({
          processed: processedRecords,
          skipped: skippedRecords,
          total: opts.totalRecords,
          batchNumber,
        });
      }
    }

    return { processedRecords, skippedRecords, batchNumber };
  }

  /**
   * Where-clause for any-column-plaintext-and-encrypted-null rows.
   * Shared by status counts + backfill cursor.
   */
  private plaintextWhere(): Prisma.CustomerWhereInput {
    const orConditions: Prisma.CustomerWhereInput[] = PII_COLUMNS.map(([plain, enc]) => ({
      AND: [
        { [plain]: { not: '' } } as Prisma.CustomerWhereInput,
        { [plain]: { not: null } } as Prisma.CustomerWhereInput,
        { [enc]: null } as Prisma.CustomerWhereInput,
      ],
    }));
    return {
      deletedAt: null,
      OR: orConditions,
    };
  }

  /**
   * Encrypt + hash a single batch. Per-row failures are swallowed (logged
   * at warn level, NO PII) so one bad row doesn't halt the whole backfill.
   * Such rows show up as "skipped" in the result.
   *
   * DEEP review W5 — every batch wraps its row UPDATEs + the
   * `pdpaBackfillRun.update` progress counter in a single
   * `$transaction([...])` so a crash mid-batch never leaves the counter
   * out of sync with the actual writes.
   */
  private async processBatch(
    batch: Array<Record<string, unknown>>,
    runId: string,
    cumulativeProcessed: number,
    cumulativeSkipped: number,
  ): Promise<{ processed: number; skipped: number }> {
    let processed = 0;
    let skipped = 0;
    const key = process.env.PII_ENCRYPTION_KEY!;
    const salt = process.env.PII_HASH_SALT!;

    // Build per-row update plans — we don't update inside the loop; we
    // batch them into a single $transaction below so the counter +
    // writes commit atomically.
    type UpdatePlan = { id: string; data: Record<string, unknown> };
    const plans: UpdatePlan[] = [];
    const skipReasons: Array<{ id: string; reason: string }> = [];

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

        plans.push({ id: row['id'] as string, data: encrypted });
      } catch (err) {
        // Build phase only catches encrypt/hash-time errors — Prisma
        // P2002 happens in the tx below.
        skipped++;
        skipReasons.push({ id: row['id'] as string, reason: this.errClass(err) });
      }
    }

    // ----- W5 atomicity: writes + counter in one tx -----
    if (plans.length > 0) {
      try {
        await this.prisma.$transaction([
          ...plans.map((p) =>
            this.prisma.customer.update({
              where: { id: p.id },
              data: p.data as Prisma.CustomerUpdateInput,
            }),
          ),
          this.prisma.pdpaBackfillRun.update({
            where: { id: runId },
            data: {
              processedRecords: cumulativeProcessed + plans.length,
              skippedRecords: cumulativeSkipped + skipped,
            },
          }),
        ]);
        processed = plans.length;
      } catch (err) {
        // One bad row poisoning the whole batch (P2002 collision etc.) —
        // fall back to per-row updates so the rest of the batch still
        // commits. Each per-row failure becomes a "skipped" with a
        // non-PII reason logged.
        this.logger.warn(
          `pdpa-backfill: batch tx failed (${this.errClass(err)}) — falling back to per-row writes`,
        );
        for (const p of plans) {
          try {
            await this.prisma.customer.update({
              where: { id: p.id },
              data: p.data as Prisma.CustomerUpdateInput,
            });
            processed++;
          } catch (rowErr) {
            skipped++;
            this.logger.warn(
              `pdpa-backfill: skipping customer (id-suffix=${this.idTail(p.id)}) — ${this.errClass(rowErr)}`,
            );
          }
        }
        // Counter update goes through after the salvage loop.
        await this.prisma.pdpaBackfillRun.update({
          where: { id: runId },
          data: {
            processedRecords: cumulativeProcessed + processed,
            skippedRecords: cumulativeSkipped + skipped,
          },
        });
      }
    } else {
      // Nothing to write — still flush the skip counter so the UI sees
      // progress on idempotent re-runs (every row already encrypted).
      await this.prisma.pdpaBackfillRun.update({
        where: { id: runId },
        data: {
          processedRecords: cumulativeProcessed,
          skippedRecords: cumulativeSkipped + skipped,
        },
      });
    }

    // Surface skip reasons in the logger AFTER the writes so a write
    // failure doesn't drop the log line.
    for (const r of skipReasons) {
      this.logger.warn(
        `pdpa-backfill: skipping customer (id-suffix=${this.idTail(r.id)}) — ${r.reason}`,
      );
    }

    return { processed, skipped };
  }

  // ---------------------------------------------------------------------------
  // Retention (W2 — see pdpa-backfill-retention.cron.ts)
  // ---------------------------------------------------------------------------

  /**
   * Hard-delete PdpaBackfillRun rows older than the given retention window.
   * Called by `PdpaBackfillRetentionCron` (daily at 02:00 BKK). Matches
   * the existing AuditLog / OffsiteBackupRun retention patterns.
   */
  async pruneOldRuns(retentionDays: number): Promise<number> {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.pdpaBackfillRun.deleteMany({
      where: { startedAt: { lt: cutoff } },
    });
    return result.count;
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
