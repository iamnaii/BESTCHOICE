import { IsEnum, IsString, IsOptional, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum CampaignTargetGroup {
  ALL = 'ALL',
  ACTIVE = 'ACTIVE',
  OVERDUE = 'OVERDUE',
  COMPLETED = 'COMPLETED',
}

export enum CampaignMessageType {
  TEXT = 'text',
  FLEX = 'flex',
}

export enum CampaignFlexTemplate {
  PROMOTION = 'promotion',
  NEW_PRODUCT = 'new-product',
  THANK_YOU = 'thank-you',
}

export class CampaignCustomData {
  @IsOptional()
  @IsString({ message: 'กรุณาระบุ title' })
  title?: string;

  @IsOptional()
  @IsString({ message: 'กรุณาระบุ subtitle' })
  subtitle?: string;

  @IsOptional()
  @IsString({ message: 'กรุณาระบุ imageUrl' })
  imageUrl?: string;

  @IsOptional()
  @IsString({ message: 'กรุณาระบุ ctaUrl' })
  ctaUrl?: string;

  @IsOptional()
  @IsString({ message: 'กรุณาระบุ price' })
  price?: string;
}

export class CampaignSendDto {
  @IsEnum(CampaignTargetGroup, { message: 'กรุณาเลือกกลุ่มเป้าหมาย (ALL, ACTIVE, OVERDUE, COMPLETED)' })
  targetGroup: CampaignTargetGroup;

  @IsEnum(CampaignMessageType, { message: 'กรุณาเลือกประเภทข้อความ (text, flex)' })
  messageType: CampaignMessageType;

  @IsOptional()
  @IsString({ message: 'กรุณาระบุข้อความ' })
  message?: string;

  @IsOptional()
  @IsEnum(CampaignFlexTemplate, { message: 'กรุณาเลือก Flex template (promotion, new-product, thank-you)' })
  flexTemplate?: CampaignFlexTemplate;

  @IsOptional()
  @IsObject({ message: 'customData ต้องเป็น object' })
  @ValidateNested()
  @Type(() => CampaignCustomData)
  customData?: CampaignCustomData;
}
