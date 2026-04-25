import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TemplateVariableDto {
  @IsString({ message: 'กรุณาระบุชื่อตัวแปร' })
  @MinLength(1, { message: 'ชื่อตัวแปรต้องไม่ว่าง' })
  @MaxLength(50, { message: 'ชื่อตัวแปรยาวเกิน 50 ตัวอักษร' })
  name!: string;

  @IsString({ message: 'กรุณาระบุชื่อแสดงผลของตัวแปร' })
  @MinLength(1, { message: 'ชื่อแสดงผลต้องไม่ว่าง' })
  @MaxLength(100, { message: 'ชื่อแสดงผลยาวเกิน 100 ตัวอักษร' })
  label!: string;
}

export class CreateSmsTemplateDto {
  @IsString({ message: 'กรุณาระบุชื่อ template' })
  @MinLength(1, { message: 'ชื่อ template ต้องไม่ว่าง' })
  @MaxLength(100, { message: 'ชื่อ template ยาวเกิน 100 ตัวอักษร' })
  name!: string;

  @IsString({ message: 'กรุณาระบุ channel' })
  @IsIn(['SMS', 'LINE'], { message: 'channel ต้องเป็น SMS หรือ LINE' })
  channel!: 'SMS' | 'LINE';

  @IsOptional()
  @IsString({ message: 'subject ต้องเป็น string' })
  @MaxLength(200, { message: 'subject ยาวเกิน 200 ตัวอักษร' })
  subject?: string | null;

  @IsString({ message: 'กรุณาระบุเนื้อหา template' })
  @MinLength(1, { message: 'เนื้อหา template ต้องไม่ว่าง' })
  @MaxLength(2000, { message: 'เนื้อหา template ยาวเกิน 2000 ตัวอักษร' })
  body!: string;

  @IsArray({ message: 'variables ต้องเป็น array' })
  @ValidateNested({ each: true })
  @Type(() => TemplateVariableDto)
  variables!: TemplateVariableDto[];

  @IsOptional()
  @IsBoolean({ message: 'active ต้องเป็น true หรือ false' })
  active?: boolean;
}
