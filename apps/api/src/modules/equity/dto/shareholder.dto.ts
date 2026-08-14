import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ShareholderType } from '@prisma/client';

export class CreateShareholderDto {
  @IsString({ message: 'กรุณากรอกชื่อผู้ถือหุ้น' })
  @MaxLength(200, { message: 'ชื่อยาวเกินไป' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'เลขผู้เสียภาษียาวเกินไป' })
  taxId?: string;

  @IsOptional()
  @IsInt({ message: 'จำนวนหุ้นต้องเป็นจำนวนเต็ม' })
  @Min(0)
  shares?: number;

  @IsOptional()
  @IsNumber({}, { message: 'สัดส่วนหุ้นไม่ถูกต้อง' })
  @Min(0)
  sharePct?: number;

  @IsOptional()
  @IsEnum(ShareholderType, { message: 'ประเภทผู้ถือหุ้นไม่ถูกต้อง' })
  type?: ShareholderType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// UpdateShareholderDto เขียนแยกเองแทนการ `extends CreateShareholderDto` — การ override
// `name` จาก required (`name!: string`) เป็น optional (`name?: string`) ในคลาสลูกชนกับ
// TS2416 (property ไม่ compatible กับ base type) ภายใต้ strictNullChecks ที่เปิดอยู่ใน
// tsconfig ของ apps/api จึงต้องประกาศทุก field ใหม่เป็น optional รวมถึง name — partial
// update ต้องแก้บางส่วนได้โดยไม่ต้องส่ง name ซ้ำ (service.updateShareholder สเปรดแบบ
// conditional อยู่แล้ว)
export class UpdateShareholderDto {
  @IsOptional()
  @IsString({ message: 'กรุณากรอกชื่อผู้ถือหุ้น' })
  @MaxLength(200, { message: 'ชื่อยาวเกินไป' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'เลขผู้เสียภาษียาวเกินไป' })
  taxId?: string;

  @IsOptional()
  @IsInt({ message: 'จำนวนหุ้นต้องเป็นจำนวนเต็ม' })
  @Min(0)
  shares?: number;

  @IsOptional()
  @IsNumber({}, { message: 'สัดส่วนหุ้นไม่ถูกต้อง' })
  @Min(0)
  sharePct?: number;

  @IsOptional()
  @IsEnum(ShareholderType, { message: 'ประเภทผู้ถือหุ้นไม่ถูกต้อง' })
  type?: ShareholderType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
