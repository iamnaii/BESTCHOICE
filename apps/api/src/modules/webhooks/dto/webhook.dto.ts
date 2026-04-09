import {
  IsString,
  IsUrl,
  IsArray,
  IsBoolean,
  IsOptional,
  ArrayMinSize,
  IsNotEmpty,
} from 'class-validator';

export class CreateWebhookDto {
  @IsString({ message: 'กรุณาระบุชื่อ webhook' })
  @IsNotEmpty({ message: 'กรุณาระบุชื่อ webhook' })
  name: string;

  @IsUrl({}, { message: 'URL ไม่ถูกต้อง กรุณาระบุ https://' })
  url: string;

  @IsString({ message: 'กรุณาระบุ secret key' })
  @IsNotEmpty({ message: 'กรุณาระบุ secret key' })
  secret: string;

  @IsArray({ message: 'กรุณาระบุ events อย่างน้อย 1 รายการ' })
  @ArrayMinSize(1, { message: 'กรุณาระบุ events อย่างน้อย 1 รายการ' })
  @IsString({ each: true })
  events: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUrl({}, { message: 'URL ไม่ถูกต้อง' })
  url?: string;

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export const SUPPORTED_EVENTS = [
  'payment.received',
  'payment.overdue',
  'contract.activated',
  'contract.completed',
  'contract.defaulted',
  'trade_in.completed',
  'customer.created',
] as const;

export type WebhookEventType = (typeof SUPPORTED_EVENTS)[number];
