import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Shared receipt-number sequencer. Used by both issuance (generateReceipt) and
 * void (credit-note number). Stateless helper — callers pass their own `tx` so
 * the advisory lock + last-number lookup run INSIDE the caller's transaction.
 */
export class ReceiptNumberService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate receipt number: RT-YYYYMM-NNNNN (CPA Policy A spec).
   *
   * Per-month sequence guarded by pg_advisory_xact_lock so concurrent generation
   * within the same month — even on the first row of a new month — stays serialised
   * and never produces duplicate -00001 sequences. Lock key is `1<YYYYMM>` (numeric)
   * to namespace receipts separately from journal entries (which use raw YYYYMM).
   * Lock auto-releases on tx commit/rollback.
   */
  async generateReceiptNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx || this.prisma;
    // W5 fix: pin YYYY/MM to Asia/Bangkok so a receipt issued at 00:30 BKK
    // on May 1 (17:30 UTC Apr 30) numbers under May, not April. Server-local
    // .getFullYear()/.getMonth() on UTC Cloud Run produced the wrong month
    // prefix at the BKK calendar boundary.
    const now = new Date();
    const bkkParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);
    const year = parseInt(bkkParts.find((p) => p.type === 'year')!.value, 10);
    const month = bkkParts.find((p) => p.type === 'month')!.value;
    const prefix = `RT-${year}${month}-`;

    const lockKey = parseInt(`1${year}${month}`, 10);
    // Use $executeRaw (not $queryRaw) for the advisory lock — pg_advisory_xact_lock
    // returns a `void`-typed column that $queryRaw cannot deserialize. This matches
    // the convention everywhere else (journal-auto, other-income/doc-number, expense
    // doc-number all use $executeRaw[Unsafe] for advisory locks).
    await db.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

    const result = await db.$queryRaw<Array<{ receiptNumber: string }>>`
      SELECT receipt_number AS "receiptNumber" FROM receipts
      WHERE receipt_number LIKE ${prefix + '%'}
      ORDER BY receipt_number DESC
      LIMIT 1
    `;

    let seq = 1;
    if (result.length > 0) {
      const lastSeq = parseInt(result[0].receiptNumber.replace(prefix, ''));
      seq = lastSeq + 1;
    }

    return `${prefix}${String(seq).padStart(5, '0')}`;
  }
}
