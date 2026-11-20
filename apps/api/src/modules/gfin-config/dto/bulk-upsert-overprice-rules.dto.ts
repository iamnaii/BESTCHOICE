import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { GfinCondition } from '@prisma/client';

export class BulkRuleTargetDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุรุ่น' })
  @MaxLength(80)
  series!: string;

  @IsEnum(GfinCondition)
  condition!: GfinCondition;
}

/** แก้เงื่อนไขหลายรุ่นพร้อมกัน (สเปก 2026-11-20 §5) — ฟิลด์ที่ไม่ส่ง = ไม่เปลี่ยน · minDownPct: null = ใช้ค่ากลาง */
export class BulkUpsertOverpriceRulesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'กรุณาเลือกอย่างน้อย 1 รุ่น' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkRuleTargetDto)
  items!: BulkRuleTargetDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  allowance?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36)
  maxMonths?: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(80)
  minDownPct?: number | null;
}
