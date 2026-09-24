import { IsOptional, IsString, MaxLength } from 'class-validator';

/** multipart: ช่อง `slip` = รูป · ฟิลด์ข้อความมาเป็น string เสมอ (แปลงในบริการ) */
export class EarlyPayoffSlipVerifyDto {
  /** ส่วนลด % บนกำไรขั้นต้น (0–50) — string เพราะ multipart; default 50 */
  @IsOptional()
  @IsString()
  discountPct?: string;
}

export class EarlyPayoffSlipConfirmDto {
  /** ตั๋วที่ได้จาก POST :id/early-payoff/slip (เซ็นโดยเซิร์ฟเวอร์ อายุ 15 นาที ผูกกับสัญญา+ผู้กด) */
  @IsString()
  @MaxLength(4096, { message: 'ตั๋วตรวจสลิปไม่ถูกต้อง' })
  ticket: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'หมายเหตุยาวเกิน 500 ตัวอักษร' })
  notes?: string;
}
