import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { GfinCondition } from '@prisma/client';

export class CreateMaxPriceDto {
  @IsString()
  @MaxLength(80)
  gfinSeries!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  gfinVariant?: string | null;

  @IsString()
  @MaxLength(20)
  storage!: string;

  @IsEnum(GfinCondition)
  condition!: GfinCondition;

  @IsNumber({ maxDecimalPlaces: 2 })
  maxPrice!: number;

  @IsString()
  @MaxLength(120)
  modelMatchPattern!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateMaxPriceDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  gfinSeries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  gfinVariant?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  storage?: string;

  @IsOptional()
  @IsEnum(GfinCondition)
  condition?: GfinCondition;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  maxPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelMatchPattern?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
