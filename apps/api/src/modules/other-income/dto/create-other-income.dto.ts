import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OtherIncomePriceType } from '@prisma/client';

export class OtherIncomeItemDto {
  @IsString()
  accountCode!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whtPct?: number;
}

export class OtherIncomeAdjustmentDto {
  @IsString()
  accountCode!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateOtherIncomeDto {
  @IsDateString()
  issueDate!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsEnum(OtherIncomePriceType)
  priceType!: OtherIncomePriceType;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  counterpartyName?: string;

  @IsOptional()
  @IsString()
  counterpartyTaxId?: string;

  @IsOptional()
  @IsString()
  counterpartyAddress?: string;

  @IsOptional()
  @IsString()
  counterpartyPhone?: string;

  @IsString()
  paymentAccountCode!: string;

  @IsNumber()
  @Min(0)
  amountReceived!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OtherIncomeItemDto)
  items!: OtherIncomeItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OtherIncomeAdjustmentDto)
  adjustments?: OtherIncomeAdjustmentDto[];

  @IsOptional()
  @IsString()
  customerNote?: string;
}
