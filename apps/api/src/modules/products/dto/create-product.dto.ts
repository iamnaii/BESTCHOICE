import { IsString, IsOptional, IsNumber, IsIn, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePriceDto {
  @IsString()
  label: string;

  @IsNumber()
  amount: number;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  brand: string;

  @IsString()
  model: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  storage?: string;

  @IsString()
  @IsOptional()
  imeiSerial?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsIn(['PHONE_NEW', 'PHONE_USED', 'TABLET', 'ACCESSORY'])
  category: string;

  @IsNumber()
  costPrice: number;

  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  poId?: string;

  @IsString()
  branchId: string;

  @IsIn(['PO_RECEIVED', 'INSPECTION', 'IN_STOCK', 'RESERVED', 'SOLD_INSTALLMENT', 'SOLD_CASH', 'REPOSSESSED', 'REFURBISHED', 'SOLD_RESELL'])
  @IsOptional()
  status?: string;

  @IsIn(['A', 'B', 'C', 'D'])
  @IsOptional()
  conditionGrade?: string;

  @IsArray()
  @IsOptional()
  photos?: string[];

  @IsNumber()
  @IsOptional()
  batteryHealth?: number;

  @IsBoolean()
  @IsOptional()
  warrantyExpired?: boolean;

  @IsString()
  @IsOptional()
  warrantyExpireDate?: string;

  @IsBoolean()
  @IsOptional()
  hasBox?: boolean;

  @IsString()
  @IsOptional()
  accessoryType?: string;

  @IsString()
  @IsOptional()
  accessoryBrand?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceDto)
  @IsOptional()
  prices?: CreatePriceDto[];
}
