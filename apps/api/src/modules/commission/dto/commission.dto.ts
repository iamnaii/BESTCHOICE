import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  MaxLength,
} from 'class-validator';

export enum CommissionRuleTypeDto {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  TIERED = 'TIERED',
}

export class CreateCommissionRuleDto {
  @IsString({ message: 'กรุณาระบุชื่อกฎค่าคอมมิชชัน' })
  @MaxLength(200, { message: 'ชื่อต้องไม่เกิน 200 ตัวอักษร' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'คำอธิบายต้องไม่เกิน 1000 ตัวอักษร' })
  description?: string;

  @IsEnum(CommissionRuleTypeDto, { message: 'ประเภทกฎต้องเป็น PERCENTAGE, FIXED_AMOUNT หรือ TIERED' })
  ruleType: CommissionRuleTypeDto;

  @IsNumber({}, { message: 'กรุณาระบุอัตราค่าคอมมิชชัน' })
  rate: number;

  @IsOptional()
  @IsNumber({}, { message: 'จำนวนเงินคงที่ต้องเป็นตัวเลข' })
  fixedAmount?: number;

  @IsOptional()
  @IsNumber({}, { message: 'ยอดขายขั้นต่ำต้องเป็นตัวเลข' })
  minSaleAmount?: number;

  @IsOptional()
  @IsNumber({}, { message: 'ยอดขายสูงสุดต้องเป็นตัวเลข' })
  maxSaleAmount?: number;
}

export class UpdateCommissionRuleDto {
  @IsOptional()
  @IsString({ message: 'กรุณาระบุชื่อกฎค่าคอมมิชชัน' })
  @MaxLength(200, { message: 'ชื่อต้องไม่เกิน 200 ตัวอักษร' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'คำอธิบายต้องไม่เกิน 1000 ตัวอักษร' })
  description?: string;

  @IsOptional()
  @IsEnum(CommissionRuleTypeDto, { message: 'ประเภทกฎต้องเป็น PERCENTAGE, FIXED_AMOUNT หรือ TIERED' })
  ruleType?: CommissionRuleTypeDto;

  @IsOptional()
  @IsNumber({}, { message: 'กรุณาระบุอัตราค่าคอมมิชชัน' })
  rate?: number;

  @IsOptional()
  @IsNumber({}, { message: 'จำนวนเงินคงที่ต้องเป็นตัวเลข' })
  fixedAmount?: number;

  @IsOptional()
  @IsNumber({}, { message: 'ยอดขายขั้นต่ำต้องเป็นตัวเลข' })
  minSaleAmount?: number;

  @IsOptional()
  @IsNumber({}, { message: 'ยอดขายสูงสุดต้องเป็นตัวเลข' })
  maxSaleAmount?: number;
}
