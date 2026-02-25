import { IsString, IsOptional, IsEnum, IsNumber, IsArray } from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  imeiSerial?: string;

  @IsOptional()
  @IsEnum(['PHONE_NEW', 'PHONE_USED', 'TABLET', 'ACCESSORY'])
  category?: string;

  @IsOptional()
  @IsNumber()
  costPrice?: number;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsEnum(['PO_RECEIVED', 'INSPECTION', 'IN_STOCK', 'RESERVED', 'SOLD_INSTALLMENT', 'SOLD_CASH', 'REPOSSESSED', 'REFURBISHED', 'SOLD_RESELL'])
  status?: string;

  @IsOptional()
  @IsEnum(['A', 'B', 'C', 'D'])
  conditionGrade?: string;

  @IsOptional()
  @IsArray()
  photos?: string[];
}
