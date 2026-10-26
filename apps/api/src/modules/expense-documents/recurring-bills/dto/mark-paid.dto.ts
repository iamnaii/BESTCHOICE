import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { RECURRING_BILL_PAID_NOTE_MAX } from '@installment/shared';

export class MarkPaidDto {
  @IsOptional()
  @IsString()
  @MaxLength(RECURRING_BILL_PAID_NOTE_MAX, { message: `หมายเหตุยาวได้ไม่เกิน ${RECURRING_BILL_PAID_NOTE_MAX} ตัวอักษร` })
  note?: string;

  /** วันที่จ่ายจริง `YYYY-MM-DD` (ปฏิทินไทย) — ว่าง = ตอนนี้ · ต้องไม่เกินวันนี้ */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่จ่ายต้องเป็นรูปแบบ YYYY-MM-DD' })
  paidAt?: string;
}
