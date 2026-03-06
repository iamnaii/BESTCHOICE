import { IsString, IsOptional, IsNumber, IsArray, IsBoolean } from 'class-validator';

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  model?: string;

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

  @IsString()
  @IsOptional()
  category?: string;

  @IsNumber()
  @IsOptional()
  costPrice?: number;

  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsOptional()
  status?: string;

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
}
