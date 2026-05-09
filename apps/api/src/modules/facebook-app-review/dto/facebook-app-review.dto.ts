import { IsString, IsOptional, IsNumber, Min, IsIn, IsBoolean } from 'class-validator';

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

// ─── pages_read_engagement ────────────────────────────────────────────────
export class ListPostCommentsDto {
  @IsString({ message: 'กรุณาระบุ Post ID' })
  postId: string;

  @IsString()
  @IsOptional()
  fields?: string;
}

// ─── pages_manage_engagement ──────────────────────────────────────────────
export class ReplyToCommentDto {
  @IsString({ message: 'กรุณาระบุ Comment ID' })
  commentId: string;

  @IsString({ message: 'กรุณาระบุข้อความตอบ' })
  message: string;
}

export class LikeCommentDto {
  @IsString({ message: 'กรุณาระบุ Comment ID' })
  commentId: string;
}

export class HideCommentDto {
  @IsString({ message: 'กรุณาระบุ Comment ID' })
  commentId: string;

  @IsBoolean({ message: 'is_hidden ต้องเป็น true หรือ false' })
  @IsOptional()
  isHidden?: boolean;
}

// ─── pages_utility_messaging — template with placeholders ─────────────────
export class SendTemplateMessageDto {
  @IsString({ message: 'กรุณาระบุ PSID ของผู้รับ' })
  recipientPsid: string;

  @IsString({ message: 'กรุณาเลือก template' })
  @IsIn(['payment_due_reminder', 'order_confirmation', 'contract_ready'], {
    message: 'template ต้องเป็นรายการที่กำหนดไว้',
  })
  templateKey: string;

  @IsString({ message: 'กรุณาระบุชื่อลูกค้า' })
  customerName: string;

  @IsString()
  @IsOptional()
  orderId?: string;

  @IsString()
  @IsOptional()
  amount?: string;

  @IsString()
  @IsOptional()
  dueDate?: string;
}

// ─── business_management ──────────────────────────────────────────────────
export class ListBusinessAdAccountsDto {
  @IsString({ message: 'กรุณาระบุ Business ID' })
  businessId: string;
}
