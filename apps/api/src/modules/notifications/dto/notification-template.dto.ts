import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { NotificationCategory, NotificationChannel } from '@prisma/client';

export class CreateNotificationTemplateDto {
  @IsString() @MaxLength(100)
  eventType!: string;

  @IsString() @MaxLength(200)
  name!: string;

  @IsEnum(NotificationCategory)
  category!: NotificationCategory;

  @IsString() @IsOptional()
  channelKey?: string;

  @IsEnum(['LINE', 'SMS', 'IN_APP'])
  channel!: NotificationChannel;

  @IsString() @IsOptional()
  format?: string;

  @IsString() @IsOptional()
  subject?: string;

  @IsString()
  messageTemplate!: string;

  @IsString() @IsOptional()
  flexTemplate?: string;

  @IsString() @IsOptional()
  description?: string;

  @IsBoolean() @IsOptional()
  isActive?: boolean;

  @IsObject() @IsOptional()
  sampleData?: Record<string, string>;
}

export class UpdateNotificationTemplateDto {
  @IsString() @MaxLength(200) @IsOptional()
  name?: string;

  @IsEnum(NotificationCategory) @IsOptional()
  category?: NotificationCategory;

  @IsString() @IsOptional()
  channelKey?: string;

  @IsEnum(['LINE', 'SMS', 'IN_APP']) @IsOptional()
  channel?: NotificationChannel;

  @IsString() @IsOptional()
  format?: string;

  @IsString() @IsOptional()
  subject?: string;

  @IsString() @IsOptional()
  messageTemplate?: string;

  @IsString() @IsOptional()
  flexTemplate?: string;

  @IsString() @IsOptional()
  description?: string;

  @IsBoolean() @IsOptional()
  isActive?: boolean;

  @IsObject() @IsOptional()
  sampleData?: Record<string, string>;
}

export class PreviewTemplateDto {
  @IsObject() @IsOptional()
  data?: Record<string, string>;
}

export class TestSendTemplateDto {
  @IsObject() @IsOptional()
  data?: Record<string, string>;
}
