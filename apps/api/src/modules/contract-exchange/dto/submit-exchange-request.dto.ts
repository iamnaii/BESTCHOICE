import {
  IsUUID, IsString, IsArray, ArrayMaxSize, IsOptional, MinLength,
  IsIn, IsNumberString, IsInt, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../journal/cpa-templates/exchange-clear-vendor-21-1106.template';

export class SubmitExchangeRequestDto {
  @IsUUID('all', { message: 'oldContractId ต้องเป็น UUID' })
  oldContractId!: string;

  @IsUUID('all', { message: 'oldProductId ต้องเป็น UUID' })
  oldProductId!: string;

  @IsUUID('all', { message: 'newProductId ต้องเป็น UUID' })
  newProductId!: string;

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'หมายเหตุอย่างน้อย 3 ตัวอักษร' })
  conditionNote?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'ภาพถ่ายไม่เกิน 5 รูป' })
  @IsString({ each: true })
  conditionPhotos?: string[];

  // ===== PRICED mode (Device Swap 2026-07) =====
  @IsOptional()
  @IsNumberString({}, { message: 'ราคารับซื้อต้องเป็นตัวเลข' })
  buybackPrice?: string;

  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D'], { message: 'สภาพเครื่องต้องเป็น A-D' })
  deviceCondition?: string;

  @IsOptional()
  @IsIn(CASH_ACCOUNT_CODES as unknown as string[], { message: 'บัญชีเงินสดไม่ถูกต้อง' })
  depositAccountCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'จำนวนงวดต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'จำนวนงวดอย่างน้อย 1' })
  @Max(48, { message: 'จำนวนงวดไม่เกิน 48' })
  newTotalMonths?: number;

  @IsOptional()
  @IsNumberString({}, { message: 'อัตราดอกเบี้ยต้องเป็นตัวเลข' })
  newInterestRate?: string;
}
