import { documentNumberLayout, bkkYyyymmdd, bkkYyyymm, bkkYyyy, type DocumentNumberFormat } from '../../../utils/document-number-format.util';
export type DocNumberFormat = DocumentNumberFormat;
import { BadRequestException, Injectable, NotImplementedException } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { DEFAULT_DOC_PREFIX_MAP, SettingsService } from '../../settings/settings.service';

/**
 * Spec default per `docs/superpowers/tracking/_owner-package/Settings_Audit_Core_v2.0.md`
 * row 1.2.2 (`doc_number_format = YYMMNNN`).
 */
export const DEFAULT_DOC_NUMBER_FORMAT: DocNumberFormat = 'PREFIX-YYMM-NNN';

const VALID_DOC_NUMBER_FORMATS: ReadonlySet<DocNumberFormat> = new Set<DocNumberFormat>([
  'PREFIX-YYMM-NNN',
  'PREFIX-YYYYMMDD-NNNN',
  'PREFIX-YYYYMM-NNNNN',
  'PREFIX-YYYY-NNNNNN',
]);

/**
 * D1.1.2.3 — whitelisted reset cycles for document-number sequences.
 *
 *   - `daily`   — advisory lock + sequence reset keyed by BKK-day.
 *                 Legacy v1 behaviour. Lock scope = YYYYMMDD.
 *   - `monthly` — lock + reset keyed by BKK-month. Lock scope = YYYYMM.
 *   - `yearly`  — (spec default) lock + reset keyed by BKK-year. Lock scope = YYYY.
 *
 * Spec reference: `docs/superpowers/tracking/_owner-package/Settings_Audit_Core_v2.0.md`
 * row 1.2.3 (`reset_cycle = yearly`).
 */
export type ResetCycle = 'daily' | 'monthly' | 'yearly';

const VALID_RESET_CYCLES: ReadonlySet<ResetCycle> = new Set<ResetCycle>([
  'daily',
  'monthly',
  'yearly',
]);

/**
 * D1.1.2.3 — spec default per Settings_Audit_Core_v2.0 row 1.2.3
 * (`reset_cycle = yearly`).
 */
export const DEFAULT_RESET_CYCLE: ResetCycle = 'yearly';

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
 */
@Injectable()
export class DocNumberService {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Generate next sequential document number with race-safe Postgres
   * advisory lock per (type, BKK-period) key. Mirrors OI/RT pattern.
   *
   * D1.1.2.1 — prefix is sourced from SystemConfig `doc_prefix_per_type`
   * with fallback to `DEFAULT_DOC_PREFIX_MAP`.
   * D1.1.2.2 — layout (date portion + seq width) driven by SystemConfig
   * `doc_number_format`. Four layouts whitelisted; unknown falls back to
   * the spec default.
   * D1.1.2.3 (sibling PR #947) — advisory-lock + sequence-lookup window
   * driven by SystemConfig `doc_number_reset_cycle` (daily/monthly/yearly).
   * Soft-reads with fallback to `daily` pre-#947.
   * D1.1.2.4 — when `doc_sequence_table_enabled = 'true'`, throws
   * `NotImplementedException`. See class docstring for rationale.
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

    const format = await this.resolveFormat();
    const cycle = await this.resolveResetCycle();
    const { datePortion, seqWidth } = documentNumberLayout(issueDate, format);
    const prefixMap = await this.resolvePrefixMap();
    const prefixLetters = prefixMap[type];
    const prefix = `${prefixLetters}-${datePortion}-`;
    // Advisory lock scope follows the reset_cycle dimension (D1.1.2.3).
    // When #947 has not yet merged, cycle defaults to `daily` so lock
    // behaviour is unchanged from pre-D1.1.2.x baseline.
    const lockScope = this.periodStartString(issueDate, cycle);
    const lockKey = this.hashLockKey(`expdoc:${type}:${cycle}:${lockScope}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.expenseDocument.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const lastSeq = last
      ? parseInt(last.number.slice(prefix.length), 10) || 0
      : 0;
    const nextSeq = lastSeq + 1;
    const maxSeq = Math.pow(10, seqWidth) - 1;
    if (nextSeq > maxSeq) {
      throw new BadRequestException(
        `เลขที่เอกสาร ${prefixLetters} เกิน ${maxSeq} ใน 1 ช่วง (BKK ${datePortion}) — ติดต่อผู้ดูแลระบบ`,
      );
    }
    const seq = String(nextSeq).padStart(seqWidth, '0');
    return `${prefix}${seq}`;
  }

  /**
   * D1.1.2.1 — fetch the active prefix map. Pulls from SettingsService when
   * available; falls back to the static `DEFAULT_DOC_PREFIX_MAP` if any error
   * surfaces (defensive: doc creation must never block on the settings query).
   */
  private async resolvePrefixMap(): Promise<Record<DocumentType, string>> {
    try {
      return await this.settings.getDocPrefixMap();
    } catch {
      return { ...DEFAULT_DOC_PREFIX_MAP };
    }
  }

  /**
   * D1.1.2.2 — fetch the active doc-number format with defensive fallback.
   * Unknown / missing values are silently coerced to the spec default so doc
   * creation never blocks on a bad SystemConfig row.
   */
  private async resolveFormat(): Promise<DocNumberFormat> {
    try {
      const raw = await this.settings.getKey('doc_number_format');
      if (raw && VALID_DOC_NUMBER_FORMATS.has(raw as DocNumberFormat)) {
        return raw as DocNumberFormat;
      }
    } catch {
      // fall through to default
    }
    return DEFAULT_DOC_NUMBER_FORMAT;
  }

  /**
   * D1.1.2.3 — fetch the active reset cycle from SystemConfig with defensive
   * fallback to the spec default (`yearly`). Unknown / missing values are
   * silently coerced so doc creation never blocks on a bad SystemConfig row.
   */
  private async resolveResetCycle(): Promise<ResetCycle> {
    try {
      const raw = await this.settings.getKey('doc_number_reset_cycle');
      if (raw && VALID_RESET_CYCLES.has(raw as ResetCycle)) {
        return raw as ResetCycle;
      }
    } catch {
      // fall through to spec default
    }
    return DEFAULT_RESET_CYCLE;
  }

  /**
   * D1.1.2.3 (sibling) — BKK period identifier string for advisory-lock
   * scope. Daily=YYYYMMDD, monthly=YYYYMM, yearly=YYYY.
   */
  private periodStartString(issueDate: Date, cycle: ResetCycle): string {
    switch (cycle) {
      case 'monthly':
        return bkkYyyymm(issueDate);
      case 'yearly':
        return bkkYyyy(issueDate);
      case 'daily':
      default:
        return bkkYyyymmdd(issueDate);
    }
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

  /** Deterministic 32-bit hash for advisory lock keys. */
  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
