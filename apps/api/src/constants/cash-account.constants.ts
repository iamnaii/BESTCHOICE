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

/**
 * ธนาคารกสิกร (KBank) — the ONLY account allowed for direct FINANCE receipt
 * on early payoff (JP4) and repossession (JP5). Owner rule 2026-07-08:
 * customers pay FINANCE via KBank transfer only; cash physically collected at
 * a branch must go through the shop-collect path (Dr 11-2107 ลูกหนี้-หน้าร้าน)
 * and be settled to FINANCE later.
 */
export const KBANK_ACCOUNT_CODE = '11-1201';
