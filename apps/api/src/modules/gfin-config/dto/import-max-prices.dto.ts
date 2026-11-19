import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GfinCondition } from '@prisma/client';

/** หนึ่งแถวของใบราคา GFIN จาก Excel (คอลัมน์ รุ่น · ความจุ · มือ 1/มือ 2 · ราคา) */
export class ImportMaxPriceItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  model!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  storage!: string;

  @IsEnum(GfinCondition)
  condition!: GfinCondition;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  maxPrice!: number;
}

export class ImportMaxPricesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ImportMaxPriceItemDto)
  items!: ImportMaxPriceItemDto[];
}
