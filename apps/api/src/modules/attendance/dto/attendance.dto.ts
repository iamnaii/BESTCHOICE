import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/** DTO หลังบ้านของการลงเวลา (สเปก §6 §8) — ข้อความไทย */
export const DAY_KINDS = ['WORK', 'DAY_OFF', 'LEAVE_SICK', 'LEAVE_PERSONAL', 'LEAVE_OTHER', 'SHOP_CLOSED'] as const;
export type DayKind = (typeof DAY_KINDS)[number];
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class BranchDayQueryDto {
  @IsUUID('4', { message: 'กรุณาระบุสาขา' })
  branchId!: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'วันที่ต้องเป็น YYYY-MM-DD' })
  date?: string;
}

export class BranchMonthQueryDto {
  @IsUUID('4', { message: 'กรุณาระบุสาขา' })
  branchId!: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'เดือนต้องเป็น YYYY-MM' })
  month!: string;
}

export class MeMonthQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'เดือนต้องเป็น YYYY-MM' })
  month?: string;
}

export class CorrectDayDto {
  @IsOptional()
  @IsISO8601({}, { message: 'เวลาเข้างานไม่ถูกต้อง' })
  clockIn?: string;

  /** null = ล้างเวลาออก (เปิดวันค้าง) */
  @IsOptional()
  @IsISO8601({}, { message: 'เวลาออกงานไม่ถูกต้อง' })
  clockOut?: string | null;

  @IsOptional()
  @IsIn(DAY_KINDS, { message: 'ประเภทวันไม่ถูกต้อง' })
  dayKind?: DayKind;

  @IsString()
  @MinLength(10, { message: 'เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร' })
  @MaxLength(500, { message: 'เหตุผลยาวเกิน 500 ตัวอักษร' })
  reason!: string;
}

export class DayKindEntryDto {
  @IsUUID('4', { message: 'พนักงานไม่ถูกต้อง' })
  userId!: string;

  @Matches(DATE_RE, { message: 'วันที่ต้องเป็น YYYY-MM-DD' })
  date!: string;

  @IsIn(DAY_KINDS, { message: 'ประเภทวันไม่ถูกต้อง' })
  dayKind!: DayKind;
}

export class SetDayKindsDto {
  @IsUUID('4', { message: 'กรุณาระบุสาขา' })
  branchId!: string;

  @IsArray()
  @ArrayMaxSize(400, { message: 'ส่งได้ไม่เกิน 400 รายการต่อครั้ง' })
  @ValidateNested({ each: true })
  @Type(() => DayKindEntryDto)
  entries!: DayKindEntryDto[];
}

export class IssueRegistrationCodeDto {
  @IsUUID('4', { message: 'กรุณาระบุสาขา' })
  branchId!: string;
}

export class BranchHoursDto {
  @IsUUID('4')
  branchId!: string;

  @IsOptional()
  @Matches(CLOCK_RE, { message: 'เวลาต้องเป็น HH:mm' })
  workStart?: string | null;

  @IsOptional()
  @Matches(CLOCK_RE, { message: 'เวลาต้องเป็น HH:mm' })
  workEnd?: string | null;
}

export class UpdateAttendanceSettingsDto {
  @IsOptional()
  @Matches(CLOCK_RE, { message: 'เวลาเข้างานต้องเป็น HH:mm' })
  workStart?: string;

  @IsOptional()
  @Matches(CLOCK_RE, { message: 'เวลาเลิกงานต้องเป็น HH:mm' })
  workEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120, { message: 'ผ่อนผันสายต้องอยู่ระหว่าง 0–120 นาที' })
  lateGraceMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3650, { message: 'อายุเก็บรูปต้องอยู่ระหว่าง 30–3650 วัน' })
  photoRetentionDays?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchHoursDto)
  branches?: BranchHoursDto[];
}

export class DeviceEventsQueryDto {
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}
