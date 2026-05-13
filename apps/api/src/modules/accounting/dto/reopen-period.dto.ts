import { IsBoolean, IsEnum, IsString, MinLength } from 'class-validator';

export enum ReopenReasonType {
  WRONG_ENTRY = 'WRONG_ENTRY',
  MISSED_RECORD = 'MISSED_RECORD',
  AUDITOR_REQUEST = 'AUDITOR_REQUEST',
  OTHER = 'OTHER',
}

export class ReopenPeriodDto {
  @IsEnum(ReopenReasonType, { message: 'reasonType ต้องเป็นหนึ่งใน WRONG_ENTRY, MISSED_RECORD, AUDITOR_REQUEST, OTHER' })
  reasonType!: ReopenReasonType;

  @IsString({ message: 'reason ต้องเป็นข้อความ' })
  @MinLength(10, { message: 'reason ต้องระบุอย่างน้อย 10 ตัวอักษร' })
  reason!: string;

  @IsBoolean({ message: 'taxFiled ต้องเป็น boolean (true/false)' })
  taxFiled!: boolean;
}
