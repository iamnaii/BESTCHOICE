import { IsString, IsNumber, IsOptional, IsBoolean, IsEnum } from 'class-validator';

enum ProductCategory {
  PHONE_NEW = 'PHONE_NEW',
  PHONE_USED = 'PHONE_USED',
  TABLET = 'TABLET',
  ACCESSORY = 'ACCESSORY',
}

export class CreatePricingTemplateDto {
  @IsString()
  brand: string;

  @IsString()
  model: string;

  @IsString()
  @IsOptional()
  storage?: string;

  @IsEnum(ProductCategory)
  category: ProductCategory;

  @IsBoolean()
  @IsOptional()
  hasWarranty?: boolean;

  @IsNumber()
  cashPrice: number;

  @IsNumber()
  installmentBestchoicePrice: number;

  @IsNumber()
  installmentFinancePrice: number;
}

export class UpdatePricingTemplateDto {
  @IsNumber()
  @IsOptional()
  cashPrice?: number;

  @IsNumber()
  @IsOptional()
  installmentBestchoicePrice?: number;

  @IsNumber()
  @IsOptional()
  installmentFinancePrice?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
