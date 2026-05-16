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
 * D1.1.2.2 — whitelisted document-number layout strings. Default is the
 * historical YYYYMMDD-NNNN; YYYYMM-NNNNN reflects a monthly cycle (5-digit
 * sequence width); YYYY-NNNNNN reflects a yearly cycle (6-digit width). The
 * per-day advisory lock continues to serialize same-day concurrent writes for
 * all formats — collision risk across different calendar days is bounded by
 * the unique constraint on `ExpenseDocument.number`. A future PR (D1.1.2.3)
 * widens the lock to per-month / per-year to remove that residual risk.
 */
export type DocNumberFormat =
  | 'PREFIX-YYYYMMDD-NNNN'
  | 'PREFIX-YYYYMM-NNNNN'
  | 'PREFIX-YYYY-NNNNNN';

export const DEFAULT_DOC_NUMBER_FORMAT: DocNumberFormat = 'PREFIX-YYYYMMDD-NNNN';

const VALID_DOC_NUMBER_FORMATS: ReadonlySet<DocNumberFormat> = new Set<DocNumberFormat>([
  'PREFIX-YYYYMMDD-NNNN',
  'PREFIX-YYYYMM-NNNNN',
  'PREFIX-YYYY-NNNNNN',
]);

@Injectable()
export class DocNumberService {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Generate next sequential document number with race-safe Postgres
   * advisory lock per (type, BKK-day) key. Mirrors OI/RT pattern.
   *
   * Format: <TYPE>-YYYYMMDD-NNNN (default) — daily reset, 4-digit seq.
   *
   * D1.1.2.2 — the date portion + sequence width are driven by SystemConfig
   * key `doc_number_format`. Three layouts are whitelisted:
   *   - `PREFIX-YYYYMMDD-NNNN` (default, current)
   *   - `PREFIX-YYYYMM-NNNNN` (5-digit seq, monthly window)
   *   - `PREFIX-YYYY-NNNNNN`  (6-digit seq, yearly window)
   * Unknown values silently fall back to the default at read time so doc
   * creation never blocks on a bad SystemConfig row.
   *
   * `issueDate` convention (W5): the BKK-day is derived from the user-chosen
   * `documentDate` (NOT server "now"), so a same-day creation backdated to
   * yesterday will still number under yesterday's sequence. This is intentional
   * — auditors expect a doc dated 2026-05-13 to carry an EX-20260513-NNNN
   * number regardless of when it was keyed in. The per-day advisory lock still
   * prevents collisions across concurrent backdates onto the same day. If the
   * convention ever needs to change, see the W5 note in fix report v1.1.
   *
   * W4 — explicit throw when seq overflows the configured digit width (would
   * otherwise emit a longer suffix that sorts wrong and breaks downstream
   * parsers). Real-world limit is ~100 docs/day on the default daily layout.
   */
  async next(
    tx: Prisma.TransactionClient,
    type: DocumentType,
    issueDate: Date,
  ): Promise<string> {
    const format = await this.resolveFormat();
    const { datePortion, seqWidth } = this.layout(issueDate, format);
    const prefixLetters = PREFIX_MAP[type];
    const prefix = `${prefixLetters}-${datePortion}-`;
    // Lock key intentionally stays per-BKK-day for now — D1.1.2.3 widens this
    // to align with the chosen reset_cycle. Per-day lock means same-day
    // concurrent writes are serialized; cross-day races are caught by the
    // unique constraint on ExpenseDocument.number.
    const lockKey = this.hashLockKey(
      `expdoc:${type}:${this.bkkYyyymmdd(issueDate)}`,
    );
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
   * D1.1.2.2 — fetch the active doc-number format with defensive fallback.
   * Unknown / missing values are silently coerced to the default so doc
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
   * D1.1.2.2 — map a `DocNumberFormat` to its date portion + seq width.
   * Pure function; no DB / IO. Exported indirectly through `next()`.
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
      default:
        return { datePortion: this.bkkYyyymmdd(issueDate), seqWidth: 4 };
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

  /** Deterministic 32-bit hash for advisory lock keys. */
  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
