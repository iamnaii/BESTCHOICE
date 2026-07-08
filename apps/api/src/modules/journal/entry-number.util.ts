import { Prisma } from '@prisma/client';

/**
 * Allocate the next journal-entry number for the month of `at`:
 * `JE-YYYYMM-NNNNN` (5-digit, zero-padded).
 *
 * Sequence = numeric MAX of the existing suffixes + 1, computed in SQL with
 * an explicit CAST so the scan is robust against everything that has bitten
 * this table before:
 *  - hard-deleted rows (count+1 collided on the gap → P2002 for the rest of
 *    the month — seen live 2026-07),
 *  - MIXED suffix widths: the manual JV path historically wrote 4-digit
 *    suffixes (JE-YYYYMM-0001) into the same column as the 5-digit auto
 *    numbers, which breaks a lexicographic max ('0009' sorts above '00019'),
 *  - suffixes past 99999 (numeric max keeps counting; padStart only pads).
 *
 * Serialised per month via a pg advisory xact lock, so concurrent posts in
 * the same month can't both read the same max. Callers must pass the
 * *transaction* client — the lock is transaction-scoped.
 */
export async function nextEntryNumber(tx: Prisma.TransactionClient, at: Date): Promise<string> {
  const ym = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}`;
  const lockKey = parseInt(ym, 10);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const prefix = `JE-${ym}-`;
  // SUBSTRING(x FROM n) is 1-indexed: for 'JE-YYYYMM-' (length 10) the
  // suffix starts at position 11. The regex guard keeps a malformed row
  // (non-numeric suffix) from blowing up the CAST.
  // `::int` on the position: Prisma binds JS numbers as bigint and
  // substring(text, bigint) has no overload in Postgres (error 42883).
  const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(SUBSTRING(entry_number FROM ${prefix.length + 1}::int) AS INTEGER)) AS max
    FROM journal_entries
    WHERE entry_number LIKE ${prefix + '%'}
      AND SUBSTRING(entry_number FROM ${prefix.length + 1}::int) ~ '^[0-9]+$'
  `;
  const next = (rows[0]?.max ?? 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}
