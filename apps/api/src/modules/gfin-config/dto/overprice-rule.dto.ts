import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { GfinCondition } from '@prisma/client';

export class CreateOverpriceRuleDto {
  @IsString()
  @MaxLength(80)
  label!: string;

  @IsString()
  @MaxLength(200)
  seriesPattern!: string;

  @IsEnum(GfinCondition)
  condition!: GfinCondition;

  @IsNumber({ maxDecimalPlaces: 2 })
  allowance!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOverpriceRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seriesPattern?: string;

  @IsOptional()
  @IsEnum(GfinCondition)
  condition?: GfinCondition;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  allowance?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
