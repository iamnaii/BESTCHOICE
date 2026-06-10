import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { AuditService } from '../audit/audit.service';
import { PdpaStatusService } from './services/pdpa-status.service';
import { PdpaBackfillService } from './services/pdpa-backfill.service';
import { PdpaRetentionService } from './services/pdpa-retention.service';

export type {
  PiiColumnPlaintextCount,
  PdpaStatus,
} from './services/pdpa-status.service';
export type {
  RunBackfillOptions,
  BackfillProgress,
  BackfillResult,
} from './services/pdpa-backfill.service';

import type { PdpaStatus } from './services/pdpa-status.service';
import type {
  RunBackfillOptions,
  BackfillResult,
} from './services/pdpa-backfill.service';

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
 *
 * This class is a thin facade — it constructs three sub-services internally
 * (Status / Backfill / Retention) and delegates. The 3-arg constructor +
 * the four static consts are preserved byte-for-byte so the CLI (reads
 * DEFAULT_BATCH_SIZE + manual-constructs) and the DI module keep working.
 */
@Injectable()
export class PdpaEncryptionService {
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

  private readonly status: PdpaStatusService;
  private readonly backfill: PdpaBackfillService;
  private readonly retention: PdpaRetentionService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly piiService: CustomerPiiService,
    private readonly audit: AuditService,
  ) {
    this.status = new PdpaStatusService(prisma, piiService);
    this.backfill = new PdpaBackfillService(prisma, audit, this.status);
    this.retention = new PdpaRetentionService(prisma);
  }

  // ---------------------------------------------------------------------------
  // Status + toggle
  // ---------------------------------------------------------------------------

  getPlaintextCountsByColumn() {
    return this.status.getPlaintextCountsByColumn();
  }

  getAnyPlaintextCount(): Promise<number> {
    return this.status.getAnyPlaintextCount();
  }

  getStatus(): Promise<PdpaStatus> {
    return this.status.getStatus();
  }

  setStrictMode(enabled: boolean): Promise<{ strictMode: boolean }> {
    return this.status.setStrictMode(enabled);
  }

  // ---------------------------------------------------------------------------
  // Backfill orchestration
  // ---------------------------------------------------------------------------

  getRun(id: string) {
    return this.backfill.getRun(id);
  }

  getRecentRuns(limit = 7) {
    return this.backfill.getRecentRuns(limit);
  }

  runBackfill(opts: RunBackfillOptions): Promise<BackfillResult> {
    return this.backfill.runBackfill(opts);
  }

  // ---------------------------------------------------------------------------
  // Retention (W2 — see pdpa-backfill-retention.cron.ts)
  // ---------------------------------------------------------------------------

  pruneOldRuns(retentionDays: number): Promise<number> {
    return this.retention.pruneOldRuns(retentionDays);
  }
}
