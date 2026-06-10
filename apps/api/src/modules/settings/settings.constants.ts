import { DocumentType } from '@prisma/client';

/**
 * Module-level constants, default tables, and pure key-classification helpers
 * shared across the decomposed Settings sub-services (Flags / Write /
 * PettyCash / DocNumberPreview). Extracted VERBATIM from the original
 * monolithic `settings.service.ts` during the Wave-4 decomposition — no
 * value/shape/regex was changed.
 */

/**
 * Keys that are exposed read-only through SystemConfig. Writes via
 * update/bulkUpdate are rejected with BadRequestException. Currently empty;
 * the machinery stays in place so a future read-only key can be added here.
 */
export const READ_ONLY_KEYS = new Set<string>([]);

/**
 * D1.1.5.5 — Whitelist of UserRoles that may hold the Petty Cash custodian
 * seat. The active role is read from SystemConfig key
 * `petty_cash_custodian_role` (default 'ACCOUNTANT'); only roles in this
 * tuple are accepted as the configured value. Picking a non-whitelisted role
 * silently falls back to ACCOUNTANT.
 */
export const PETTY_CASH_CUSTODIAN_ROLES = ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
export type PettyCashCustodianRole = (typeof PETTY_CASH_CUSTODIAN_ROLES)[number];

/**
 * D1.1.2.1 — default mapping from DocumentType → 2-4 letter prefix. Mirrors the
 * pre-Phase-2 hardcoded PREFIX_MAP in `DocNumberService` and serves as the
 * fallback when SystemConfig key `doc_prefix_per_type` is missing or malformed.
 * Keep keys in sync with the `DocumentType` enum in `schema.prisma`.
 */
export const DEFAULT_DOC_PREFIX_MAP: Record<DocumentType, string> = {
  EXPENSE: 'EX',
  CREDIT_NOTE: 'CN',
  PAYROLL: 'PR',
  VENDOR_SETTLEMENT: 'SE',
  PETTY_CASH_REIMBURSEMENT: 'PC',
  // SP5 Phase 2 — Repair service expense doc
  REPAIR_SERVICE: 'RS',
};

/** Validation regex — 2 to 4 uppercase Latin letters. Mirrors A-Z constraint
 *  used by downstream JE templates + spreadsheet parsers. */
export const DOC_PREFIX_REGEX = /^[A-Z]{2,4}$/;

/**
 * P2-SP2 — whitelisted doc-number formats. Mirrors `DocNumberFormat` in
 * `expense-documents/services/doc-number.service.ts`. Duplicated here (small,
 * stable enum) so SettingsService doesn't pull in a dependency on the expense
 * module. The DocNumberService is the source of truth for live numbering;
 * this set powers value-validation on the SystemConfig key write + preview.
 */
export const VALID_DOC_NUMBER_FORMATS = [
  'PREFIX-YYMM-NNN',
  'PREFIX-YYYYMMDD-NNNN',
  'PREFIX-YYYYMM-NNNNN',
  'PREFIX-YYYY-NNNNNN',
] as const;
export type DocNumberFormatValue = (typeof VALID_DOC_NUMBER_FORMATS)[number];
export const DEFAULT_DOC_NUMBER_FORMAT_VALUE: DocNumberFormatValue = 'PREFIX-YYMM-NNN';

/**
 * P2-SP2 — whitelisted reset cycles. Lowercase to match `ResetCycle` in
 * `expense-documents/services/doc-number.service.ts`.
 */
export const VALID_DOC_NUMBER_RESET_CYCLES = ['daily', 'monthly', 'yearly'] as const;
export type DocNumberResetCycleValue = (typeof VALID_DOC_NUMBER_RESET_CYCLES)[number];
export const DEFAULT_DOC_NUMBER_RESET_CYCLE: DocNumberResetCycleValue = 'yearly';

/**
 * P2-SP2 — supplemental doc-type keys for the Document Config UI. These are
 * NOT in the Prisma `DocumentType` enum (which only covers expense-side docs)
 * but appear in the UI per the spec: OTHER_INCOME (OI), RECEIPT (RT),
 * PETTY_CASH alias (PC), CONTRACT (CT). They're persisted in the same
 * `doc_prefix_per_type` JSON object alongside the canonical DocumentType keys.
 * Downstream services that don't recognise these keys silently ignore them
 * (`getDocPrefixMap()` only reads canonical keys back into the typed map).
 */
export const EXTRA_DOC_TYPE_KEYS = ['OTHER_INCOME', 'RECEIPT', 'CONTRACT'] as const;
export type ExtraDocTypeKey = (typeof EXTRA_DOC_TYPE_KEYS)[number];

/**
 * Defaults for the extra UI-only doc types. Mirrors hardcoded prefixes used
 * by OtherIncomeService (`OI`), receipt numbering (`RT`), and contract numbering
 * (`CT`). The Petty Cash key collides with the canonical
 * `PETTY_CASH_REIMBURSEMENT` already in `DEFAULT_DOC_PREFIX_MAP` (`PC`).
 */
export const DEFAULT_EXTRA_DOC_PREFIX_MAP: Record<ExtraDocTypeKey, string> = {
  OTHER_INCOME: 'OI',
  RECEIPT: 'RT',
  CONTRACT: 'CT',
};

/**
 * Keys whose values are secrets (API tokens, bank credentials). The audit
 * log records the key name + that a change happened, but never the raw
 * value — we don't want cleartext secrets sitting in AuditLog JSON.
 */
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /credential/i,
  /private[_-]?key/i,
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(key));
}

export function redact(key: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return isSensitiveKey(key) ? '[REDACTED]' : value;
}
