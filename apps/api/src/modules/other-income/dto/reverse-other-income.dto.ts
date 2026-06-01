import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OtherIncomeReverseReason } from '@prisma/client';

/**
 * Reverse-document DTO.
 *
 * C16 — `reason` is strictly validated against the Prisma enum
 * `OtherIncomeReverseReason`. Without this check, an invalid string would slip
 * past Nest's ValidationPipe, hit `prisma.otherIncome.update({ data: {
 * reverseReason: dto.reason }})` inside the reversal transaction, and crash
 * mid-flight with a 500 — leaving the reversal JE written but the doc-status
 * flip never persisted (orphan record). class-validator rejects bad values at
 * the controller boundary with a 400 instead.
 *
 * InternalControlActionBar — `reasonLabel` is the OPTIONAL human-readable
 * label picked by the user from the admin-managed `reverse_reasons` table.
 * When provided, it's stored alongside the enum-typed `reason` so audit
 * analytics (e.g. "most common reverse reason last month") can group by the
 * real label rather than the coarse `OTHER` bucket. The enum still carries
 * the canonical category for backwards-compat reports.
 */
export class ReverseOtherIncomeDto {
  @IsEnum(OtherIncomeReverseReason, {
    message:
      'reason ไม่ถูกต้อง — ต้องเป็นหนึ่งใน INPUT_ERROR, DUPLICATE, CANCELED_BY_CUSTOMER, OTHER',
  })
  reason!: OtherIncomeReverseReason;

  @IsString({ message: 'กรุณาระบุหมายเหตุการกลับรายการ' })
  @IsNotEmpty({ message: 'กรุณาระบุหมายเหตุการกลับรายการ' })
  @MinLength(5, { message: 'หมายเหตุต้องยาวอย่างน้อย 5 ตัวอักษร' })
  note!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'reasonLabel ยาวเกินไป (สูงสุด 200 ตัวอักษร)' })
  reasonLabel?: string;
}
