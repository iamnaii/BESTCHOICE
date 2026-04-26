import { IsString, IsOptional, IsNumber, Min, IsIn } from 'class-validator';

export class CreateAdCampaignDto {
  @IsString({ message: 'กรุณาระบุชื่อ campaign' })
  name: string;

  @IsString()
  @IsOptional()
  @IsIn(
    [
      'OUTCOME_TRAFFIC',
      'OUTCOME_ENGAGEMENT',
      'OUTCOME_LEADS',
      'OUTCOME_SALES',
      'OUTCOME_AWARENESS',
      'OUTCOME_APP_PROMOTION',
    ],
    { message: 'objective ไม่ถูกต้อง' },
  )
  objective?: string;

  @IsNumber({}, { message: 'daily budget ต้องเป็นตัวเลข (บาท)' })
  @Min(1, { message: 'daily budget ต้อง ≥ 1 บาท' })
  @IsOptional()
  dailyBudget?: number;
}

export class UpdateCampaignStatusDto {
  @IsString()
  @IsIn(['ACTIVE', 'PAUSED', 'DELETED'], {
    message: 'status ต้องเป็น ACTIVE, PAUSED หรือ DELETED',
  })
  status: string;
}

export class CreateLiveVideoDto {
  @IsString({ message: 'กรุณาระบุหัวข้อไลฟ์' })
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsIn(['LIVE_NOW', 'SCHEDULED_UNPUBLISHED'], {
    message: 'status ต้องเป็น LIVE_NOW หรือ SCHEDULED_UNPUBLISHED',
  })
  status?: string;

  @IsNumber()
  @IsOptional()
  plannedStartTime?: number;
}

export class PublishVideoDto {
  @IsString({ message: 'กรุณาระบุ URL วิดีโอ' })
  fileUrl: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class SendStandardMessageDto {
  @IsString({ message: 'กรุณาระบุ PSID ของผู้รับ' })
  recipientPsid: string;

  @IsString({ message: 'กรุณาระบุข้อความ' })
  text: string;
}

export class SubscribePageWebhooksDto {
  @IsString()
  @IsOptional()
  fields?: string;
}
