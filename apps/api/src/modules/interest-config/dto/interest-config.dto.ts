import { IsString, IsNumber, IsArray, IsBoolean, IsOptional, Min, Max } from 'class-validator';

export class CreateInterestConfigDto {
  @IsString()
  name: string;

  @IsArray()
  @IsString({ each: true })
  productCategories: string[]; // e.g. ["PHONE_NEW"], ["PHONE_USED"]

  @IsNumber()
  @Min(0)
  @Max(1)
  interestRate: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  minDownPaymentPct: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  storeCommissionPct?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  vatPct?: number;

  @IsNumber()
  @Min(1)
  minInstallmentMonths: number;

  @IsNumber()
  @Min(1)
  maxInstallmentMonths: number;
}

export class UpdateInterestConfigDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  productCategories?: string[];

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  interestRate?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  minDownPaymentPct?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  storeCommissionPct?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  vatPct?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  minInstallmentMonths?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  maxInstallmentMonths?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
