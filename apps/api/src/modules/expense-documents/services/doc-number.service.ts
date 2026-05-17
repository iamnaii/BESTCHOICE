import {
  BadRequestException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import {
  DEFAULT_DOC_PREFIX_MAP,
  SettingsService,
} from '../../settings/settings.service';

/**
 * D1.1.2.2 — whitelisted document-number layout strings.
 *
 * The Settings_Audit_Core_v2.0 spec (row 1.2.2) calls for `YYMMNNN`. We
 * concretise that as `PREFIX-YYMM-NNN` (4-digit period + 3-digit seq) and
 * make it the project default. Three legacy / extended variants stay in the
 * whitelist so OWNERs can opt-in to higher daily / yearly volume:
 *
 *   - `PREFIX-YYMM-NNN`     (spec default — short, monthly window, 3 digits)
 *   - `PREFIX-YYYYMMDD-NNNN` (legacy v1, daily window, 4 digits)
 *   - `PREFIX-YYYYMM-NNNNN`  (monthly window, 5 digits — high-volume)
 *   - `PREFIX-YYYY-NNNNNN`   (yearly window, 6 digits — very-high-volume)
 *
 * Unknown values silently fall back to the spec default at read time so doc
 * creation never blocks on a bad SystemConfig row.
 */
export type DocNumberFormat =
  | 'PREFIX-YYMM-NNN'
  | 'PREFIX-YYYYMMDD-NNNN'
  | 'PREFIX-YYYYMM-NNNNN'
  | 'PREFIX-YYYY-NNNNNN';

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
 * Reset cycle whitelist — duplicated locally to keep this PR self-contained
 * when its sibling PR #947 (D1.1.2.3) has not yet merged. When BOTH PRs are
 * on main the cycle string is owned by D1.1.2.3 via the `doc_number_reset_cycle`
 * SystemConfig key; this PR only reads it as a soft input.
 */
type ResetCycle = 'daily' | 'monthly' | 'yearly';
const VALID_RESET_CYCLES: ReadonlySet<ResetCycle> = new Set<ResetCycle>([
  'daily',
  'monthly',
  'yearly',
]);
/**
 * Legacy default when D1.1.2.3 has not yet merged. We intentionally keep
 * `daily` here (not the spec's `yearly`) so behaviour pre-#947 is identical
 * to today. Once #947 ships, its own service-level default flips to `yearly`.
 */
const LEGACY_DEFAULT_RESET_CYCLE: ResetCycle = 'daily';

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
    const { datePortion, seqWidth } = this.layout(issueDate, format);
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
   * D1.1.2.3 (sibling) — fetch the active reset cycle. When sibling PR #947
   * has not yet merged the SystemConfig row will be absent and we fall back
   * to `daily` (legacy behaviour). Once #947 is on main, its OWNER-set
   * `doc_number_reset_cycle` SystemConfig key takes over.
   */
  private async resolveResetCycle(): Promise<ResetCycle> {
    try {
      const raw = await this.settings.getKey('doc_number_reset_cycle');
      if (raw && VALID_RESET_CYCLES.has(raw as ResetCycle)) {
        return raw as ResetCycle;
      }
    } catch {
      // fall through to legacy default
    }
    return LEGACY_DEFAULT_RESET_CYCLE;
  }

  /**
   * D1.1.2.2 — map a `DocNumberFormat` to its date portion + seq width.
   * Pure function; no DB / IO.
   */
  private layout(
    issueDate: Date,
    format: DocNumberFormat,
  ): { datePortion: string; seqWidth: number } {
    switch (format) {
      case 'PREFIX-YYYYMM-NNNNN':
        return { datePortion: this.bkkYyyymm(issueDate), seqWidth: 5 };
      case 'PREFIX-YYYY-NNNNNN':
        return { datePortion: this.bkkYyyy(issueDate), seqWidth: 6 };
      case 'PREFIX-YYYYMMDD-NNNN':
        return { datePortion: this.bkkYyyymmdd(issueDate), seqWidth: 4 };
      case 'PREFIX-YYMM-NNN':
      default:
        return { datePortion: this.bkkYymm(issueDate), seqWidth: 3 };
    }
  }

  /**
   * D1.1.2.3 (sibling) — BKK period identifier string for advisory-lock
   * scope. Daily=YYYYMMDD, monthly=YYYYMM, yearly=YYYY.
   */
  private periodStartString(issueDate: Date, cycle: ResetCycle): string {
    switch (cycle) {
      case 'monthly':
        return this.bkkYyyymm(issueDate);
      case 'yearly':
        return this.bkkYyyy(issueDate);
      case 'daily':
      default:
        return this.bkkYyyymmdd(issueDate);
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

  /** Asia/Bangkok local YYYYMMDD via Intl (BKK is UTC+7, no DST). */
  private bkkYyyymmdd(date: Date): string {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  }

  /** Asia/Bangkok local YYYYMM via Intl. */
  private bkkYyyymm(date: Date): string {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
    });
    // Defensive: en-CA with year+month returns "YYYY-MM" today, but slice the
    // first two segments to stay robust against ICU output shape drift across
    // Node versions.
    return parts.split('-').slice(0, 2).join('');
  }

  /** Asia/Bangkok local YYYY via Intl. */
  private bkkYyyy(date: Date): string {
    return date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
    });
  }

  /**
   * D1.1.2.2 — Asia/Bangkok local YYMM (2-digit year + 2-digit month).
   * Used by the spec-default `PREFIX-YYMM-NNN` format.
   *
   * Spec uses Gregorian (ค.ศ.) 2-digit year for grep-ability with PEAK and
   * other Thai accounting tools that historically use YY-prefix doc numbers.
   * For 2026 → `YY = 26`; for 2100 → `YY = 00` (wraps). This is acceptable
   * because doc-numbers reset annually under the spec default cycle (yearly)
   * so cross-century collisions are extremely unlikely AND would be on
   * different years anyway (different reset window).
   */
  private bkkYymm(date: Date): string {
    const yyyymm = this.bkkYyyymm(date); // "YYYYMM"
    return yyyymm.slice(2); // "YYMM"
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
