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
 *   - `daily`   (default) — advisory lock + sequence reset keyed by BKK-day.
 *                Existing behaviour. Lock key = `(prefix, YYYYMMDD)`.
 *   - `monthly` — lock + reset keyed by BKK-month. Lock key = `(prefix, YYYYMM)`.
 *                 Recommended pairing with `doc_number_format = PREFIX-YYYYMM-NNNNN`.
 *   - `yearly`  — lock + reset keyed by BKK-year. Lock key = `(prefix, YYYY)`.
 *                 Recommended pairing with `doc_number_format = PREFIX-YYYY-NNNNNN`.
 */
export type ResetCycle = 'daily' | 'monthly' | 'yearly';

export const DEFAULT_RESET_CYCLE: ResetCycle = 'daily';

const VALID_RESET_CYCLES: ReadonlySet<ResetCycle> = new Set<ResetCycle>([
  'daily',
  'monthly',
  'yearly',
]);

@Injectable()
export class DocNumberService {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Generate next sequential document number with race-safe Postgres
   * advisory lock per (type, BKK-period) key. The period boundary depends
   * on the configured `doc_number_reset_cycle` (default daily).
   *
   * D1.1.2.3 — the advisory lock key now hashes `(prefix, cycle, periodStart)`
   * where `periodStart` is the BKK YYYYMMDD / YYYYMM / YYYY string for the
   * chosen reset cycle. Sequence resets implicitly: the `startsWith` lookup
   * matches only numbers issued within the current period, so a fresh period
   * starts its sequence at 0001.
   *
   * The emitted number always carries the full BKK YYYYMMDD date portion
   * regardless of cycle (preserves backwards compatibility with downstream
   * report parsers). The cycle only changes WHEN the sequence resets — not
   * the visible format. D1.1.2.2 (format) is a separate dimension.
   *
   * `issueDate` convention (W5): the BKK period is derived from the user-chosen
   * `documentDate` (NOT server "now"), so a same-day creation backdated to
   * yesterday will still number under yesterday's sequence. This is intentional
   * — auditors expect a doc dated 2026-05-13 to carry an EX-20260513-NNNN
   * number regardless of when it was keyed in. The per-period advisory lock
   * still prevents collisions across concurrent backdates onto the same
   * period. If the convention ever needs to change, see W5 in fix report v1.1.
   *
   * W4 — explicit throw when seq > 9999 (would overflow the 4-digit slot and
   * silently produce a 5-digit number that sorts wrong). Monthly/yearly
   * cycles hit this faster — D1.1.2.2 widens the slot to compensate.
   */
  async next(
    tx: Prisma.TransactionClient,
    type: DocumentType,
    issueDate: Date,
  ): Promise<string> {
    const cycle = await this.resolveResetCycle();
    const periodStart = this.periodStartString(issueDate, cycle);
    const yyyymmdd = this.bkkYyyymmdd(issueDate);
    const prefixLetters = PREFIX_MAP[type];
    const prefix = `${prefixLetters}-${yyyymmdd}-`;
    const lockKey = this.hashLockKey(`expdoc:${type}:${cycle}:${periodStart}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    // Sequence lookup window is keyed by the period prefix. For daily we look
    // up `EX-20260510-%`; for monthly `EX-202605%` (all days in May 2026
    // share one sequence); for yearly `EX-2026%`.
    const lookupPrefix = `${prefixLetters}-${periodStart}`;
    const last = await tx.expenseDocument.findFirst({
      where: { number: { startsWith: lookupPrefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const lastSeq = last ? this.extractTrailingSeq(last.number) : 0;
    const nextSeq = lastSeq + 1;
    if (nextSeq > 9999) {
      throw new BadRequestException(
        `เลขที่เอกสาร ${prefixLetters} เกิน 9999 ใน 1 ช่วง (${cycle} ${periodStart}) — ติดต่อผู้ดูแลระบบ`,
      );
    }
    const seq = String(nextSeq).padStart(4, '0');
    return `${prefix}${seq}`;
  }

  /**
   * D1.1.2.3 — fetch the active reset cycle with defensive fallback. Unknown
   * / missing values are silently coerced to the default so doc creation
   * never blocks on a bad SystemConfig row.
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
   * D1.1.2.3 — BKK YYYYMMDD / YYYYMM / YYYY identifier string for the
   * issue date's containing period under the given cycle.
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
   * Parses the last `-`-delimited segment so it handles any future D1.1.2.2
   * layout without changes.
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
