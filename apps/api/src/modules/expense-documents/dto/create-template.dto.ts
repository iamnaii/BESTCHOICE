import {
  IsString, IsOptional, IsIn, IsBoolean, IsInt, Min, Max, MinLength, ValidateIf, IsObject,
} from 'class-validator';

const DOC_TYPES = ['EXPENSE', 'CREDIT_NOTE', 'PAYROLL', 'VENDOR_SETTLEMENT'] as const;

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

  @ValidateIf((o) => o.isRecurring === true)
  @IsInt()
  @Min(1)
  @Max(31, { message: 'วันต้องอยู่ระหว่าง 1-31' })
  recurringDay?: number;
}
