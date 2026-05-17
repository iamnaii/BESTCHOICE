import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { SettingsService } from '../../settings/settings.service';

const PREFIX_MAP: Record<DocumentType, string> = {
  EXPENSE: 'EX',
  CREDIT_NOTE: 'CN',
  PAYROLL: 'PR',
  VENDOR_SETTLEMENT: 'SE',
  PETTY_CASH_REIMBURSEMENT: 'PC',
};

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

/**
 * Spec default per Settings_Audit_Core_v2.0 row 1.2.3.
 */
export const DEFAULT_RESET_CYCLE: ResetCycle = 'yearly';

const VALID_RESET_CYCLES: ReadonlySet<ResetCycle> = new Set<ResetCycle>([
  'daily',
  'monthly',
  'yearly',
]);

/**
 * D1.1.2.2 format whitelist — duplicated locally to keep this PR self-contained
 * when its sibling PR #941 (D1.1.2.2) has not yet merged. When BOTH PRs are
 * on main the format string is owned by D1.1.2.2 via the `doc_number_format`
 * SystemConfig key; this PR only reads it as a soft input.
 *
 * C6.1 (deep review) — the emitted number's date portion + seq width MUST
 * follow the configured format. Hard-coding YYYYMMDD here (as previous draft
 * did) breaks the spec's `YYMMNNN` default.
 */
type DocNumberFormat =
  | 'PREFIX-YYMM-NNN'
  | 'PREFIX-YYYYMMDD-NNNN'
  | 'PREFIX-YYYYMM-NNNNN'
  | 'PREFIX-YYYY-NNNNNN';

const VALID_DOC_NUMBER_FORMATS: ReadonlySet<DocNumberFormat> = new Set<DocNumberFormat>([
  'PREFIX-YYMM-NNN',
  'PREFIX-YYYYMMDD-NNNN',
  'PREFIX-YYYYMM-NNNNN',
  'PREFIX-YYYY-NNNNNN',
]);

/**
 * Legacy default when D1.1.2.2 has not yet merged. We intentionally keep
 * `PREFIX-YYYYMMDD-NNNN` here (not the spec's `PREFIX-YYMM-NNN`) so emitted
 * numbers pre-#941 are identical to today's `EX-20260510-0001` form.
 * Once #941 ships, its OWNER-set `doc_number_format` SystemConfig key takes
 * over (and its service-level default flips to the spec's YYMM-NNN).
 */
const LEGACY_DEFAULT_FORMAT: DocNumberFormat = 'PREFIX-YYYYMMDD-NNNN';

@Injectable()
export class DocNumberService {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Generate next sequential document number with race-safe Postgres
   * advisory lock per (type, cycle, BKK-period) key. Mirrors OI/RT pattern.
   *
   * D1.1.2.3 — the advisory-lock + sequence-lookup window is driven by
   * SystemConfig key `doc_number_reset_cycle`. Three cycles whitelisted:
   *   - `daily`   — legacy v1, per-day window
   *   - `monthly` — per-month window
   *   - `yearly`  — (spec default) per-year window
   * Unknown values silently fall back to the spec default at read time.
   *
   * D1.1.2.2 (sibling PR #941) — the visible layout (date portion + seq
   * width) is driven by SystemConfig key `doc_number_format`. This PR
   * reads that key with a defensive fallback to the legacy
   * `PREFIX-YYYYMMDD-NNNN` form so behaviour pre-#941 is identical to
   * today's `EX-20260510-0001` numbers.
   *
   * **C6.1 fix:** previous draft hard-coded YYYYMMDD in the emitted number.
   * Now the date portion + seq width follow the active format, so when
   * BOTH PRs ship the composition is e.g. `EX-2605-001` (yearly cycle +
   * YYMM-NNN format) instead of the meaningless `EX-20260510-001`.
   *
   * `issueDate` convention (W5): the BKK period is derived from the
   * user-chosen `documentDate` (NOT server "now"), so a same-day creation
   * backdated to yesterday will still number under yesterday's sequence.
   *
   * W4 — explicit throw when seq overflows the configured digit width.
   */
  async next(
    tx: Prisma.TransactionClient,
    type: DocumentType,
    issueDate: Date,
  ): Promise<string> {
    const cycle = await this.resolveResetCycle();
    const format = await this.resolveFormat();
    const { datePortion, seqWidth } = this.layout(issueDate, format);
    const periodStart = this.periodStartString(issueDate, cycle);
    const prefixLetters = PREFIX_MAP[type];
    const emitPrefix = `${prefixLetters}-${datePortion}-`;
    // Lookup prefix follows the CYCLE window expressed in the FORMAT's year
    // representation (2-digit vs 4-digit). When the cycle resolution is
    // finer than the format expresses, fall back to the format's datePortion
    // (e.g. format=YYMM-NNN + cycle=daily is degenerate → effectively monthly).
    const lookupPrefix = `${prefixLetters}-${this.lookupPeriodPrefix(issueDate, format, cycle)}`;
    const lockKey = this.hashLockKey(`expdoc:${type}:${cycle}:${periodStart}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.expenseDocument.findFirst({
      where: { number: { startsWith: lookupPrefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const lastSeq = last ? this.extractTrailingSeq(last.number) : 0;
    const nextSeq = lastSeq + 1;
    const maxSeq = Math.pow(10, seqWidth) - 1;
    if (nextSeq > maxSeq) {
      throw new BadRequestException(
        `เลขที่เอกสาร ${prefixLetters} เกิน ${maxSeq} ใน 1 ช่วง (${cycle} ${periodStart}) — ติดต่อผู้ดูแลระบบ`,
      );
    }
    const seq = String(nextSeq).padStart(seqWidth, '0');
    return `${emitPrefix}${seq}`;
  }

  /**
   * D1.1.2.3 — compute the sequence-lookup prefix for the (format, cycle)
   * pair. The lookup prefix is a `startsWith` substring of the emitted
   * number — it MUST be a leading substring of `${prefixLetters}-${datePortion}-`
   * so that all docs issued in the same cycle window match.
   *
   * Tables:
   *
   * | format        | daily        | monthly | yearly |
   * |---------------|--------------|---------|--------|
   * | YYMM-NNN      | YYMM*        | YYMM    | YY     |
   * | YYYYMMDD-NNNN | YYYYMMDD     | YYYYMM  | YYYY   |
   * | YYYYMM-NNNNN  | YYYYMM*      | YYYYMM  | YYYY   |
   * | YYYY-NNNNNN   | YYYY*        | YYYY*   | YYYY   |
   *
   *  *Degenerate combos — cycle resolution finer than format expresses;
   *  effectively the format's own period.
   */
  private lookupPeriodPrefix(
    issueDate: Date,
    format: DocNumberFormat,
    cycle: ResetCycle,
  ): string {
    const useTwoDigitYear = format === 'PREFIX-YYMM-NNN';
    const yy = this.bkkYyyy(issueDate).slice(2);
    const yyyy = this.bkkYyyy(issueDate);
    const mm = this.bkkYyyymm(issueDate).slice(-2);
    switch (cycle) {
      case 'yearly':
        return useTwoDigitYear ? yy : yyyy;
      case 'monthly':
        return useTwoDigitYear ? `${yy}${mm}` : `${yyyy}${mm}`;
      case 'daily':
      default: {
        // Daily lookup only makes sense for formats that include the day.
        // Fall back to the format's own datePortion for day-less formats.
        const { datePortion } = this.layout(issueDate, format);
        return datePortion;
      }
    }
  }

  /**
   * D1.1.2.3 — fetch the active reset cycle with defensive fallback. Unknown
   * / missing values are silently coerced to the spec default (`yearly`) so
   * doc creation never blocks on a bad SystemConfig row.
   */
  private async resolveResetCycle(): Promise<ResetCycle> {
    try {
      const raw = await this.settings.getKey('doc_number_reset_cycle');
      if (raw && VALID_RESET_CYCLES.has(raw as ResetCycle)) {
        return raw as ResetCycle;
      }
    } catch {
      // fall through
    }
    return DEFAULT_RESET_CYCLE;
  }

  /**
   * D1.1.2.2 (sibling) — fetch the active doc-number format. When sibling
   * PR #941 has not yet merged the SystemConfig row will be absent and we
   * fall back to legacy `PREFIX-YYYYMMDD-NNNN` (so emitted numbers stay
   * identical to today's `EX-20260510-0001` form). Once #941 is on main,
   * its OWNER-set `doc_number_format` SystemConfig key takes over.
   */
  private async resolveFormat(): Promise<DocNumberFormat> {
    try {
      const raw = await this.settings.getKey('doc_number_format');
      if (raw && VALID_DOC_NUMBER_FORMATS.has(raw as DocNumberFormat)) {
        return raw as DocNumberFormat;
      }
    } catch {
      // fall through to legacy default
    }
    return LEGACY_DEFAULT_FORMAT;
  }

  /**
   * D1.1.2.2 (sibling) — map a `DocNumberFormat` to its date portion + seq
   * width. Pure function; no DB / IO.
   */
  private layout(
    issueDate: Date,
    format: DocNumberFormat,
  ): { datePortion: string; seqWidth: number } {
    switch (format) {
      case 'PREFIX-YYMM-NNN':
        return { datePortion: this.bkkYymm(issueDate), seqWidth: 3 };
      case 'PREFIX-YYYYMM-NNNNN':
        return { datePortion: this.bkkYyyymm(issueDate), seqWidth: 5 };
      case 'PREFIX-YYYY-NNNNNN':
        return { datePortion: this.bkkYyyy(issueDate), seqWidth: 6 };
      case 'PREFIX-YYYYMMDD-NNNN':
      default:
        return { datePortion: this.bkkYyyymmdd(issueDate), seqWidth: 4 };
    }
  }

  /**
   * D1.1.2.3 — BKK YYYYMMDD / YYYYMM / YYYY identifier string for the
   * issue date's containing period under the given cycle. Used as the
   * advisory-lock scope dimension.
   */
  private periodStartString(issueDate: Date, cycle: ResetCycle): string {
    switch (cycle) {
      case 'monthly':
        return this.getBkkMonthBounds(issueDate).yyyymm;
      case 'yearly':
        return this.getBkkYearBounds(issueDate).yyyy;
      case 'daily':
      default:
        return this.bkkYyyymmdd(issueDate);
    }
  }

  /**
   * D1.1.2.3 — extract the trailing NNNN sequence from a document number.
   * Parses the last `-`-delimited segment so it handles any D1.1.2.2
   * layout (3-digit / 4-digit / 5-digit / 6-digit) without changes.
   */
  private extractTrailingSeq(docNumber: string): number {
    const segs = docNumber.split('-');
    return parseInt(segs[segs.length - 1], 10) || 0;
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
   * D1.1.2.2 (sibling) — Asia/Bangkok local YYMM (2-digit year + month).
   * Used by the spec-default `PREFIX-YYMM-NNN` format. See sibling PR #941
   * for full discussion of the 2-digit-year wraparound trade-off.
   */
  private bkkYymm(date: Date): string {
    return this.bkkYyyymm(date).slice(2);
  }

  /**
   * D1.1.2.3 — BKK month bounds (start of 1st → start of next month UTC) +
   * YYYYMM identifier string. Mirrors `getBkkDayBounds()` style.
   */
  getBkkMonthBounds(date: Date): { start: Date; end: Date; yyyymm: string } {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
    });
    const [y, m] = parts.split('-').slice(0, 2).map((s) => parseInt(s, 10));
    const yyyymm = `${y}${String(m).padStart(2, '0')}`;
    // BKK midnight on 1st = UTC 17:00 previous day.
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const start = new Date(Date.UTC(y, m - 1, 1) - bkkOffsetMs);
    const end = new Date(Date.UTC(y, m, 1) - bkkOffsetMs);
    return { start, end, yyyymm };
  }

  /**
   * D1.1.2.3 — BKK year bounds (start of Jan 1 → start of next Jan 1) +
   * YYYY identifier string.
   */
  getBkkYearBounds(date: Date): { start: Date; end: Date; yyyy: string } {
    const yyyy = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
    });
    const y = parseInt(yyyy, 10);
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const start = new Date(Date.UTC(y, 0, 1) - bkkOffsetMs);
    const end = new Date(Date.UTC(y + 1, 0, 1) - bkkOffsetMs);
    return { start, end, yyyy };
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
