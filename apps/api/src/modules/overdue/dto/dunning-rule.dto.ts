import {
  IsString,
  IsInt,
  IsBoolean,
  IsEnum,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { DunningChannel, UserRole } from '@prisma/client';

export class CreateDunningRuleDto {
  @IsString({ message: 'กรุณาระบุชื่อ rule' })
  @MinLength(1, { message: 'ชื่อ rule ต้องมีอย่างน้อย 1 ตัวอักษร' })
  @MaxLength(200, { message: 'ชื่อ rule ต้องไม่เกิน 200 ตัวอักษร' })
  name: string;

  @IsInt({ message: 'กรุณาระบุวันที่ trigger เป็นจำนวนเต็ม (ลบ = ก่อนครบกำหนด, บวก = หลังครบกำหนด)' })
  triggerDay: number;

  @IsEnum(DunningChannel, { message: 'channel ต้องเป็น LINE, SMS, CALL_TASK หรือ INTERNAL_ALERT' })
  channel: DunningChannel;

  @IsString({ message: 'กรุณาระบุ template ข้อความ' })
  @MinLength(1, { message: 'template ข้อความต้องมีอย่างน้อย 1 ตัวอักษร' })
  @MaxLength(2000, { message: 'template ข้อความต้องไม่เกิน 2000 ตัวอักษร' })
  messageTemplate: string;

  // P3 E2: optional reference to SmsTemplate by name. When set the engine
  // prefers the SmsTemplate body; otherwise falls back to messageTemplate.
  @IsString({ message: 'templateName ต้องเป็น string' })
  @MaxLength(100, { message: 'templateName ยาวเกิน 100 ตัวอักษร' })
  @IsOptional()
  templateName?: string | null;

  @IsBoolean({ message: 'includePaymentLink ต้องเป็น true หรือ false' })
  @IsOptional()
  includePaymentLink?: boolean;

  @IsBoolean({ message: 'autoExecute ต้องเป็น true หรือ false' })
  @IsOptional()
  autoExecute?: boolean;

  @IsEnum(UserRole, { message: 'escalateTo ต้องเป็น role ที่ถูกต้อง' })
  @IsOptional()
  escalateTo?: UserRole | null;

  @IsBoolean({ message: 'isActive ต้องเป็น true หรือ false' })
  @IsOptional()
  isActive?: boolean;

  @IsInt({ message: 'sortOrder ต้องเป็นจำนวนเต็ม' })
  @IsOptional()
  sortOrder?: number;
}

export class UpdateDunningRuleDto {
  @IsString({ message: 'กรุณาระบุชื่อ rule' })
  @MinLength(1, { message: 'ชื่อ rule ต้องมีอย่างน้อย 1 ตัวอักษร' })
  @MaxLength(200, { message: 'ชื่อ rule ต้องไม่เกิน 200 ตัวอักษร' })
  @IsOptional()
  name?: string;

  @IsInt({ message: 'กรุณาระบุวันที่ trigger เป็นจำนวนเต็ม (ลบ = ก่อนครบกำหนด, บวก = หลังครบกำหนด)' })
  @IsOptional()
  triggerDay?: number;

  @IsEnum(DunningChannel, { message: 'channel ต้องเป็น LINE, SMS, CALL_TASK หรือ INTERNAL_ALERT' })
  @IsOptional()
  channel?: DunningChannel;

  @IsString({ message: 'กรุณาระบุ template ข้อความ' })
  @MinLength(1, { message: 'template ข้อความต้องมีอย่างน้อย 1 ตัวอักษร' })
  @MaxLength(2000, { message: 'template ข้อความต้องไม่เกิน 2000 ตัวอักษร' })
  @IsOptional()
  messageTemplate?: string;

  @IsString({ message: 'templateName ต้องเป็น string' })
  @MaxLength(100, { message: 'templateName ยาวเกิน 100 ตัวอักษร' })
  @IsOptional()
  templateName?: string | null;

  @IsBoolean({ message: 'includePaymentLink ต้องเป็น true หรือ false' })
  @IsOptional()
  includePaymentLink?: boolean;

  @IsBoolean({ message: 'autoExecute ต้องเป็น true หรือ false' })
  @IsOptional()
  autoExecute?: boolean;

  @IsEnum(UserRole, { message: 'escalateTo ต้องเป็น role ที่ถูกต้อง' })
  @IsOptional()
  escalateTo?: UserRole | null;

  @IsBoolean({ message: 'isActive ต้องเป็น true หรือ false' })
  @IsOptional()
  isActive?: boolean;

  @IsInt({ message: 'sortOrder ต้องเป็นจำนวนเต็ม' })
  @IsOptional()
  sortOrder?: number;
}
