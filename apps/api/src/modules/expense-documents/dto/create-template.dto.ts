import {
  IsString, IsOptional, IsIn, IsBoolean, IsInt, Min, Max, MinLength, IsObject, Matches,
} from 'class-validator';

const DOC_TYPES = ['EXPENSE', 'CREDIT_NOTE', 'PAYROLL', 'VENDOR_SETTLEMENT'] as const;
const RECURRENCE_KINDS = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

export class CreateTemplateDto {
  @IsString()
  @MinLength(1, { message: 'ชื่อ template ห้ามว่าง' })
  name!: string;

  @IsString()
  @IsIn([...DOC_TYPES])
  documentType!: string;

  @IsString()
  branchId!: string;

  @IsObject()
  prefilledData!: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  /** D5 บิลประจำ — วันครบกำหนดจ่าย 1–31 (เดือนที่มีไม่ถึงใช้วันสุดท้าย) · กติกาคู่ฟิลด์ตรวจใน service บนแถวที่รวมแล้ว */
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'วันต้องอยู่ระหว่าง 1-31' })
  @Max(31, { message: 'วันต้องอยู่ระหว่าง 1-31' })
  recurringDay?: number;

  @IsOptional()
  @IsString()
  @IsIn([...RECURRENCE_KINDS], { message: 'ความถี่ต้องเป็น รายเดือน / ราย 3 เดือน / รายปี' })
  recurrence?: (typeof RECURRENCE_KINDS)[number];

  /** QUARTERLY: 1–3 (เดือนที่เท่าไรของไตรมาส) · YEARLY: 1–12 */
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'เดือนต้องอยู่ระหว่าง 1-12' })
  @Max(12, { message: 'เดือนต้องอยู่ระหว่าง 1-12' })
  recurringMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0, { message: 'เตือนล่วงหน้าได้ 0-30 วัน' })
  @Max(30, { message: 'เตือนล่วงหน้าได้ 0-30 วัน' })
  reminderLeadDays?: number;

  /** วันที่เริ่มนับงวดแรก `YYYY-MM-DD` (ปฏิทินไทย) — ว่าง = วันนี้ */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันเริ่มนับงวดต้องเป็นรูปแบบ YYYY-MM-DD' })
  startsOn?: string;
}
