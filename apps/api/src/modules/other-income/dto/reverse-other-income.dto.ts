import { IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
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
}
