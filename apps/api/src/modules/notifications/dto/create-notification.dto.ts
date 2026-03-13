import { IsString, IsOptional, IsArray, IsDateString } from 'class-validator';

export class SendNotificationDto {
  @IsString()
  channel: string; // LINE, SMS, IN_APP

  @IsString()
  recipient: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  message: string;

  @IsString()
  @IsOptional()
  relatedId?: string;

  @IsString()
  @IsOptional()
  fallbackPhone?: string; // SMS fallback if LINE fails
}

export class CreateNotificationTemplateDto {
  @IsString()
  name: string;

  @IsString()
  eventType: string; // PAYMENT_REMINDER, OVERDUE_NOTICE, PAYMENT_SUCCESS, CONTRACT_DEFAULT

  @IsString()
  channel: string; // LINE, SMS

  @IsString()
  @IsOptional()
  format?: string; // 'text' | 'flex' — default 'text'

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  messageTemplate: string; // text message or JSON string for flex

  @IsString()
  @IsOptional()
  flexTemplate?: string; // LINE Flex Message JSON (with placeholders)

  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateNotificationTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  format?: string; // 'text' | 'flex'

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  messageTemplate?: string;

  @IsString()
  @IsOptional()
  flexTemplate?: string; // LINE Flex Message JSON

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  isActive?: boolean;
}

export class ScheduleNotificationDto {
  @IsString()
  templateId: string;

  @IsString()
  contractId: string;

  @IsDateString()
  scheduledAt: string;
}

export class BulkNotificationDto {
  @IsString()
  templateId: string;

  @IsArray()
  @IsString({ each: true })
  contractIds: string[];
}
