import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** POST /device-returns/:id/confirm — spec 2026-09-20 §5.2 */
export class ConfirmDeviceReturnDto {
  /** วันลงบัญชี (JP5 entryDate) — ไม่ส่ง = วันนี้; ต้องเดือนปัจจุบัน BKK (assertRepossessionPeriodsOpen) */
  @IsOptional()
  @IsDateString({}, { message: 'วันที่ลงบัญชีไม่ถูกต้อง' })
  paymentDate?: string;

  /** ส่วนลดยอดปิด % — ไม่ส่ง = 50 (computePayoffQuote); มีผลเฉพาะตัวเลขบนแถวยึด ไม่ลง JE */
  @IsOptional()
  @IsNumber({}, { message: 'ส่วนลดต้องเป็นตัวเลข' })
  @Min(0, { message: 'ส่วนลดต้องไม่ติดลบ' })
  @Max(100, { message: 'ส่วนลดต้องไม่เกิน 100%' })
  discountPct?: number;
}
