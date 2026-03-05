import { IsString, IsNumber, IsOptional, IsBoolean, IsIn, Min } from 'class-validator';

export class CreateReorderPointDto {
  @IsString()
  brand: string;

  @IsString()
  model: string;

  @IsString()
  @IsOptional()
  storage?: string;

  @IsIn(['PHONE_NEW', 'PHONE_USED', 'TABLET', 'ACCESSORY'])
  category: string;

  @IsString()
  branchId: string;

  @IsNumber()
  @Min(1)
  minQuantity: number;

  @IsNumber()
  @Min(1)
  reorderQuantity: number;
}

export class UpdateReorderPointDto {
  @IsNumber()
  @IsOptional()
  @Min(1)
  minQuantity?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  reorderQuantity?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
