import {
  BadRequestException,
  Injectable,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { SettingsService } from '../../settings/settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildStartsWithPrefix,
  formatDocNumber,
  getPeriodBounds,
  hashLockKey,
  parseSequence,
} from '../../../utils/doc-number-format.util';

const PREFIX_MAP: Record<DocumentType, string> = {
  EXPENSE: 'EX',
  CREDIT_NOTE: 'CN',
  PAYROLL: 'PR',
  VENDOR_SETTLEMENT: 'SE',
  PETTY_CASH_REIMBURSEMENT: 'PC',
};

/**
 * Map our internal DocumentType enum to the SP4 `DocumentNumberConfig.docType`
 * key (the same short code the UI shows to OWNER, e.g. 'EX', 'CN').
 */
const CONFIG_DOC_TYPE: Record<DocumentType, string> = {
  EXPENSE: 'EX',
  CREDIT_NOTE: 'CN',
  PAYROLL: 'PR',
  VENDOR_SETTLEMENT: 'SE',
  PETTY_CASH_REIMBURSEMENT: 'PC',
};

/**
 * D1.1.2.4 — SystemConfig key `doc_sequence_table_enabled` (default `'false'`).
 *
 * Owner picked "accept current behavior" for Q3 — current implementation uses
 * a PostgreSQL advisory lock + `MAX(docNumber)` lookup inside the same DB
 * transaction. This works correctly under normal load (~100 docs/day) and
 * doesn't require an additional table.
 *
 * The flag is reserved as a **forward-extension point** for a future migration
 * to a dedicated `DocumentSequence` model. When `true`, the service throws
 * `NotImplementedException` so the OWNER realizes the migration hasn't
 * happened yet — silent fallback would create the impression a feature exists
 * when it doesn't.
 *
 * --- SP4 ---
 *
 * The service now reads `DocumentNumberConfig` (when injected + row present) to
 * pick prefix/format/resetCadence/digitCount. If the row is missing OR the
 * PrismaService isn't injected (legacy unit tests) it falls back to the
 * hard-coded `<TYPE>-YYYYMMDD-NNNN` convention so existing callers/tests are
 * unaffected.
 */
@Injectable()
export class DocNumberService {
  constructor(
    private readonly settings: SettingsService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /**
   * Generate next sequential document number with race-safe Postgres
   * advisory lock per (type, period) key.
   *
   * Legacy format: <TYPE>-YYYYMMDD-NNNN (daily reset, 4-digit seq).
   * SP4: format/prefix/cadence/digitCount come from DocumentNumberConfig when
   * a row exists for the docType.
   *
   * `issueDate` convention (W5): the BKK-period is derived from the user-chosen
   * `documentDate` (NOT server "now"). Auditors expect a doc dated 2026-05-13
   * to carry an EX-20260513-NNNN number regardless of when it was keyed in.
   *
   * W4 — explicit throw when seq exceeds the configured `digitCount` slot.
   */
  async next(
    tx: Prisma.TransactionClient,
    type: DocumentType,
    issueDate: Date,
  ): Promise<string> {
    // D1.1.2.4 — sequence table not implemented; reject explicitly if OWNER
    // has flipped the flag without an accompanying migration.
    if (await this.isSequenceTableEnabled()) {
      throw new NotImplementedException(
        'Sequence table mode not implemented yet — please disable this flag (doc_sequence_table_enabled = false)',
      );
    }

    // SP4: try to read config; on any failure fall back to legacy hard-coded path.
    const config = await this.tryLoadConfig(CONFIG_DOC_TYPE[type]);
    const prefix = config?.prefix || PREFIX_MAP[type];
    const format = config?.format || '{prefix}-{YYYYMMDD}-{NNNN}';
    const cadence = config?.resetCadence || 'DAILY';
    const digitCount = config?.digitCount || 4;

    const bounds = getPeriodBounds(issueDate, cadence);
    const startsWith = buildStartsWithPrefix(format, prefix, issueDate);
    const lockKey = hashLockKey(`expdoc:${type}:${bounds.periodKey}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.expenseDocument.findFirst({
      where: { number: { startsWith } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const lastSeq = last ? parseSequence(last.number, startsWith) : 0;
    const nextSeq = lastSeq + 1;
    const maxSeq = Math.pow(10, digitCount) - 1;
    if (nextSeq > maxSeq) {
      throw new BadRequestException(
        `เลขที่เอกสาร ${prefix} เกิน ${maxSeq} ใน 1 ${this.cadenceLabel(cadence)} — ติดต่อผู้ดูแลระบบ`,
      );
    }
    return formatDocNumber(format, prefix, nextSeq, issueDate, digitCount);
  }

  /**
   * D1.1.2.4 — read `doc_sequence_table_enabled` flag. Defensive: any error
   * resolving the flag (DB down, malformed value) is treated as "false" so
   * doc creation continues using the advisory-lock fast path. Only an
   * explicit `'true'` / `'1'` value (case-insensitive) enables the throw branch.
   */
  private async isSequenceTableEnabled(): Promise<boolean> {
    try {
      const raw = await this.settings.getKey('doc_sequence_table_enabled');
      if (!raw) return false;
      const v = raw.trim().toLowerCase();
      return v === 'true' || v === '1';
    } catch {
      return false;
    }
  }

  /**
   * SP4 — load the active config for a docType. Returns null on any error so
   * the legacy hard-coded path remains in effect:
   *   - PrismaService not injected (legacy unit tests)
   *   - Config row missing (docType not yet seeded)
   *   - Table missing (running against a DB that hasn't migrated yet)
   *   - inactive (active=false)
   */
  private async tryLoadConfig(docType: string) {
    if (!this.prisma) return null;
    try {
      const row = await this.prisma.documentNumberConfig.findUnique({
        where: { docType },
      });
      if (!row || row.deletedAt || !row.active) return null;
      return row;
    } catch {
      return null;
    }
  }

  private cadenceLabel(cadence: string): string {
    switch (cadence) {
      case 'MONTHLY':
        return 'เดือน';
      case 'YEARLY':
        return 'ปี';
      case 'NEVER':
        return 'รอบ';
      case 'DAILY':
      default:
        return 'วัน';
    }
  }
}
