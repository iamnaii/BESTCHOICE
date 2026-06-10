import * as os from 'os';
import { Prisma } from '@prisma/client';

/**
 * Shared, stateless helpers for the PDPA encryption seam.
 *
 * Extracted from PdpaEncryptionService so PdpaStatusService and
 * PdpaBackfillService share the same PII column inventory + plaintext
 * where-clause + non-PII logging helpers. Behaviour is byte-identical to
 * the original private methods.
 *
 * Hard rule (inherited): **NEVER log decrypted PII**. The helpers here only
 * ever surface id tails + error class names + truncated error messages.
 */

/**
 * 10 Customer PII columns this service tracks. The status / strict-mode /
 * backfill code paths all need the same column inventory — keeping it in
 * one constant means adding an 11th PII column is a single-line change.
 *
 * Each tuple = [plaintext column, encrypted column].
 *
 * Trade-in PII (`transfer_account_*`) is intentionally NOT included —
 * those columns are owned by `TradeInService` and have their own
 * dual-write path.
 */
export const PII_COLUMNS: ReadonlyArray<[plain: string, enc: string]> = [
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

/** Truncate cap on error message column (matches OffsiteBackupRun pattern). */
export const ERROR_TRUNC_CHARS = 1000;

/**
 * Where-clause for any-column-plaintext-and-encrypted-null rows.
 * Shared by status counts + backfill cursor.
 */
export function plaintextWhere(): Prisma.CustomerWhereInput {
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

export function truncErr(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  return msg.length > ERROR_TRUNC_CHARS ? msg.slice(0, ERROR_TRUNC_CHARS) + '…' : msg;
}

/** Last 8 chars of the row UUID — enough for ops to grep, no PII. */
export function idTail(id: unknown): string {
  return typeof id === 'string' ? id.slice(-8) : 'unknown';
}

export function errClass(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code: unknown }).code);
  }
  if (err instanceof Error) return err.constructor.name;
  return 'Unknown';
}

export function safeHostname(): string {
  try {
    return os.hostname();
  } catch {
    return 'unknown';
  }
}
