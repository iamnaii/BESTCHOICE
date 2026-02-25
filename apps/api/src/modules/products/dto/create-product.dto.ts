import { IsString, IsOptional, IsNumber, IsEnum, IsArray, ValidateNested, IsBoolean } from 'class-validator';
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
  imeiSerial?: string;

  @IsString()
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

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  conditionGrade?: string;

  @IsArray()
  @IsOptional()
  photos?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceDto)
  @IsOptional()
  prices?: CreatePriceDto[];
}
