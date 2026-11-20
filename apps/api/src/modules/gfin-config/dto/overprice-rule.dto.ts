import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
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

  /** ผ่อนได้สูงสุด (งวด) ของซีรีส์/สภาพนี้ตามตารางราคา GFIN — null/ไม่ส่ง = ไม่จำกัด */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(36)
  maxMonths?: number | null;

  /** ดาวน์ขั้นต่ำ % ของกลุ่มรุ่นนี้ (เต็มร้อย) — null/ไม่ส่ง = ใช้ค่าตั้ง gfin.minDownPct · ช่วงเดียวกับค่าตั้ง (0–80) */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(80)
  minDownPct?: number | null;

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
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(36)
  maxMonths?: number | null;

  /** ดาวน์ขั้นต่ำ % ของกลุ่มรุ่นนี้ (เต็มร้อย) — null/ไม่ส่ง = ใช้ค่าตั้ง gfin.minDownPct · ช่วงเดียวกับค่าตั้ง (0–80) */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(80)
  minDownPct?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
