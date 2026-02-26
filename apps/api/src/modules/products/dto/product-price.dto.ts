import { IsString, IsNumber, IsBoolean, IsOptional } from 'class-validator';

export class CreateProductPriceDto {
  @IsString()
  label: string;

  @IsNumber()
  amount: number;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class UpdateProductPriceDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
