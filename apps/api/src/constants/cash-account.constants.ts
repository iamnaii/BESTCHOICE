/**
 * Cash account dimension whitelist — single source of truth.
 *
 * Per `.claude/rules/accounting.md` "Cash Account Dimension":
 *   Payment.depositAccountCode accepts one of 6 codes:
 *     11-1101, 11-1102, 11-1103 (per-person cash)
 *     11-1201, 11-1202, 11-1203 (bank accounts)
 *   Pre-filled from User.defaultCashAccountCode.
 *   Required on every Payment record.
 *
 * Any DTO/service that validates a cash account code MUST import from here.
 * Adding a new account = update this file once.
 */
export const CASH_ACCOUNT_CODES = [
  '11-1101',
  '11-1102',
  '11-1103',
  '11-1201',
  '11-1202',
  '11-1203',
] as const;

export type CashAccountCode = (typeof CASH_ACCOUNT_CODES)[number];
