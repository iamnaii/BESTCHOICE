import { IsString, IsOptional, IsEnum, IsNumber, IsArray } from 'class-validator';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  brand: string;

  @IsString()
  model: string;

  @IsOptional()
  @IsString()
  imeiSerial?: string;

  @IsEnum(['PHONE_NEW', 'PHONE_USED', 'TABLET', 'ACCESSORY'])
  category: string;

  @IsNumber()
  costPrice: number;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsString()
  branchId: string;

  @IsOptional()
  @IsEnum(['A', 'B', 'C', 'D'])
  conditionGrade?: string;

  @IsOptional()
  @IsArray()
  photos?: string[];
}
