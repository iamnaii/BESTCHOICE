import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsObject } from 'class-validator';

export class CreateStickerTemplateDto {
  @IsString()
  name: string;

  @IsNumber()
  sizeWidthMm: number;

  @IsNumber()
  sizeHeightMm: number;

  @IsObject()
  layoutConfig: Record<string, unknown>;

  @IsArray()
  @IsOptional()
  placeholders?: string[];
}

export class UpdateStickerTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  sizeWidthMm?: number;

  @IsNumber()
  @IsOptional()
  sizeHeightMm?: number;

  @IsObject()
  @IsOptional()
  layoutConfig?: Record<string, unknown>;

  @IsArray()
  @IsOptional()
  placeholders?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
