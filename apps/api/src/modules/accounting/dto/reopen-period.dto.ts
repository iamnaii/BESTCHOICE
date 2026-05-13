import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export enum ReopenReasonType {
  WRONG_ENTRY = 'WRONG_ENTRY',
  MISSED_RECORD = 'MISSED_RECORD',
  AUDITOR_REQUEST = 'AUDITOR_REQUEST',
  OTHER = 'OTHER',
}

export class ReopenPeriodDto {
  // ─── Period locators (mirrors CloseMonthDto) ─────────────────────────────
  @IsString({ message: 'companyId ต้องเป็น string' })
  companyId!: string;

  @IsInt({ message: 'ปีต้องเป็นจำนวนเต็ม' })
  @Min(2020)
  year!: number;

  @IsInt({ message: 'เดือนต้องเป็น 1-12' })
  @Min(1)
  @Max(12)
  month!: number;

  /**
   * T2-C10 — Required only when reopening a CLOSED period older than 90 days.
   */
  @IsString()
  @IsOptional()
  boardResolutionId?: string;

  // ─── Reason taxonomy ─────────────────────────────────────────────────────
  @IsEnum(ReopenReasonType, { message: 'reasonType ต้องเป็นหนึ่งใน WRONG_ENTRY, MISSED_RECORD, AUDITOR_REQUEST, OTHER' })
  reasonType!: ReopenReasonType;

  @IsString({ message: 'reason ต้องเป็นข้อความ' })
  @MinLength(10, { message: 'reason ต้องระบุอย่างน้อย 10 ตัวอักษร' })
  reason!: string;

  @IsBoolean({ message: 'taxFiled ต้องเป็น boolean (true/false)' })
  taxFiled!: boolean;
}
