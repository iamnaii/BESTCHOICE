import { IsString, IsOptional, IsArray, IsDateString, IsBoolean, IsEnum, IsUUID, ValidateIf } from 'class-validator';
import { NotificationCategory } from '../notification-category.enum';

export type LineChannelKey = 'line-shop' | 'line-finance' | 'line-staff';
export const LINE_CHANNEL_KEYS: LineChannelKey[] = ['line-shop', 'line-finance', 'line-staff'];

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

  // Time-sensitive messages (e.g. OTP with 10-min TTL) should not be queued
  // for delayed retry — retries would arrive after the OTP has already expired
  // and spam the recipient. Caller sets this to true to skip the retry queue.
  @IsBoolean()
  @IsOptional()
  noRetry?: boolean;

  // Routing key for LINE channel — selects which OA (and therefore which
  // channelToken) to use. Required when channel === 'LINE' (Phase 7 hardening
  // after every call site has been updated explicitly in Phase 4-5). Ignored
  // for SMS / IN_APP. NotificationsService.send() also enforces this at
  // runtime so JS callers can't bypass DTO validation.
  @ValidateIf((o) => o.channel === 'LINE')
  @IsEnum(LINE_CHANNEL_KEYS, { message: 'channelKey จำเป็นสำหรับ LINE — ต้องเป็น line-shop, line-finance หรือ line-staff' })
  channelKey?: LineChannelKey;

  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsEnum(NotificationCategory)
  @IsOptional()
  category?: NotificationCategory;

  @IsBoolean()
  @IsOptional()
  bypassCompliance?: boolean;
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
