import { IsString, IsOptional, IsIn, IsDateString, MaxLength } from 'class-validator';

/**
 * C3 — Reverse Dialog payload. Replaces the previously parameterless
 * `POST /expense-documents/:id/void`. All fields optional for backward
 * compatibility with older callers that still send an empty body.
 *
 * `reasonCode` is one of 6 canonical strings (per mockup 02E). UI dropdown
 * sources the same labels. `reasonDetail` is free-text for any context that
 * doesn't fit a canonical reason. Both end up in the AuditLog row's
 * `newValue` JSON for forensic queryability.
 *
 * `reverseDate` lets the reversal JE post on a user-chosen date (still
 * subject to V19 period-open guard). When omitted, the existing behavior
 * (today, BKK noon) is preserved.
 */
export const REVERSE_REASON_CODES = [
  'data_entry_error',     // ป้อนข้อมูลผิด
  'wrong_vendor',         // ผู้ขายผิด
  'wrong_amount',         // จำนวนเงินผิด
  'duplicate_entry',      // ข้อมูลซ้ำ
  'cancel_transaction',   // ยกเลิกรายการ
  'other',                // อื่นๆ (ต้องระบุใน reasonDetail)
] as const;

export type ReverseReasonCode = (typeof REVERSE_REASON_CODES)[number];

export class VoidExpenseDocumentDto {
  @IsString()
  @IsIn([...REVERSE_REASON_CODES], {
    message: `เหตุผลการกลับรายการต้องเป็นหนึ่งใน: ${REVERSE_REASON_CODES.join(', ')}`,
  })
  @IsOptional()
  reasonCode?: ReverseReasonCode;

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
