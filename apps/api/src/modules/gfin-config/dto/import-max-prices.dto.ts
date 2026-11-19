import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(80)
  model!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
  @ArrayMinSize(1, { message: 'ใบราคาต้องมีอย่างน้อย 1 แถว' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ImportMaxPriceItemDto)
  items!: ImportMaxPriceItemDto[];
}
