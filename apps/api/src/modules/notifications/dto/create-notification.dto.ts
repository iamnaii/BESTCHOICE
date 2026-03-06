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
  subject?: string;

  @IsString()
  messageTemplate: string; // with placeholders like {customer_name}, {amount}, etc.

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
  subject?: string;

  @IsString()
  @IsOptional()
  messageTemplate?: string;

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
