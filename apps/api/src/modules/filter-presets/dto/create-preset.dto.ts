import {
  IsString,
  IsEnum,
  IsObject,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { FilterPresetScope } from '@prisma/client';

export class CreatePresetDto {
  @IsString({ message: 'กรุณาระบุชื่อ preset' })
  @MinLength(1, { message: 'ชื่อ preset ต้องไม่ว่าง' })
  @MaxLength(50, { message: 'ชื่อ preset ยาวเกิน 50 ตัวอักษร' })
  name!: string;

  @IsEnum(FilterPresetScope, { message: 'scope ไม่ถูกต้อง' })
  scope!: FilterPresetScope;

  @IsString({ message: 'กรุณาระบุ page' })
  page!: string;

  @IsObject({ message: 'filterJson ต้องเป็น object' })
  filterJson!: Record<string, any>;

  @IsOptional()
  @IsString()
  branchId?: string;
}
