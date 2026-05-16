import { IsString, IsOptional, IsDateString, MaxLength } from 'class-validator';

/**
 * C3 — Reverse Dialog payload. Replaces the previously parameterless
 * `POST /expense-documents/:id/void`. All fields optional for backward
 * compatibility with older callers that still send an empty body.
 *
 * `reasonCode` is validated at the SERVICE layer against the configured
 * reasons list (D1.2.7.2 — `reverse_reasons` SystemConfig key, default = the
 * 6 codes below). DTO keeps the field permissive so OWNER can introduce
 * custom codes via SystemConfig without a redeploy.
 *
 * `reasonDetail` is free-text for any context that doesn't fit a canonical
 * reason. Both end up in the AuditLog row's `newValue` JSON for forensic
 * queryability.
 *
 * `reverseDate` lets the reversal JE post on a user-chosen date (still
 * subject to V19 period-open guard). When omitted, the existing behavior
 * (today, BKK noon) is preserved.
 */
export const DEFAULT_REVERSE_REASONS = [
  { code: 'data_entry_error',   label: 'ป้อนข้อมูลผิด' },
  { code: 'wrong_vendor',       label: 'ผู้ขายผิด' },
  { code: 'wrong_amount',       label: 'จำนวนเงินผิด' },
  { code: 'duplicate_entry',    label: 'ข้อมูลซ้ำ' },
  { code: 'cancel_transaction', label: 'ยกเลิกรายการ' },
  { code: 'other',              label: 'อื่นๆ (ระบุรายละเอียด)' },
] as const;

/** Back-compat — code-only string union of the default whitelist. */
export const REVERSE_REASON_CODES = DEFAULT_REVERSE_REASONS.map((r) => r.code);
export type ReverseReasonCode = (typeof DEFAULT_REVERSE_REASONS)[number]['code'];

export class VoidExpenseDocumentDto {
  /**
   * Validated against the configured `reverse_reasons` list inside `voidDocument`
   * (D1.2.7.2). DTO keeps the @IsString minimum so OWNER can extend codes via
   * SystemConfig without DTO redeploy.
   */
  @IsString()
  @MaxLength(64)
  @IsOptional()
  reasonCode?: string;

  @IsString()
  @MaxLength(500, { message: 'รายละเอียดเหตุผลยาวเกิน 500 ตัวอักษร' })
  @IsOptional()
  reasonDetail?: string;

  /**
   * ISO date string. When set, the reversal JE postedAt uses this date
   * (V19 period-open guard still applies). Omitted = today BKK noon.
   */
  @IsDateString({}, { message: 'วันที่กลับรายการไม่ถูกต้อง' })
  @IsOptional()
  reverseDate?: string;
}
