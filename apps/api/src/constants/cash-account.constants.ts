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
 * SHOP-side cash/bank accounts (S-prefixed partition — P3-SP5). Used by the
 * payroll SHOP scope (คำสั่งเจ้าของ 2026-08-06): a SHOP payroll document must
 * pay out of a SHOP cash/bank account, never a FINANCE one.
 * Codes mirror shop-coa.csv (S11-1101..1103 เงินสดสาขา, S11-1201 KBank รับ,
 * S11-1202 SCB จ่าย).
 */
export const SHOP_CASH_ACCOUNT_CODES = [
  'S11-1101',
  'S11-1102',
  'S11-1103',
  'S11-1201',
  'S11-1202',
] as const;

export type ShopCashAccountCode = (typeof SHOP_CASH_ACCOUNT_CODES)[number];

/** Union list for DTO-level validation on payroll (scope-consistency is
 *  enforced in the service with a Thai error message). */
export const PAYROLL_CASH_ACCOUNT_CODES = [
  ...CASH_ACCOUNT_CODES,
  ...SHOP_CASH_ACCOUNT_CODES,
] as const;

/**
 * ธนาคารกสิกร (KBank) — the ONLY account allowed for direct FINANCE receipt
 * on early payoff (JP4) and repossession (JP5). Owner rule 2026-07-08:
 * customers pay FINANCE via KBank transfer only; cash physically collected at
 * a branch must go through the shop-collect path (Dr 11-2107 ลูกหนี้-หน้าร้าน)
 * and be settled to FINANCE later.
 */
export const KBANK_ACCOUNT_CODE = '11-1201';
