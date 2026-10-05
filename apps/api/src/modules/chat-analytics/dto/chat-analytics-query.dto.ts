import { IsEmpty, IsIn, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import {
  JOURNEY_STAGES,
  type JourneyStage,
  CHAT_CYCLE_METRICS,
  CHAT_WORK_METRICS,
  type ChatCycleMetric,
  type ChatWorkMetric,
} from '@installment/shared';
import { StaffInboxQueryDto } from '../../staff-chat/dto/staff-inbox.dto';
export class ChatAnalyticsQueryDto extends StaffInboxQueryDto {
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  from!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  to!: string;
  @IsOptional() @IsIn(['FACEBOOK', 'LINE_SHOP', 'LINE_FINANCE', 'TIKTOK', 'WEB']) channel?: string;
  @IsOptional() @IsUUID() staffId?: string;
  @IsEmpty({ message: 'ยังไม่มี snapshot งานค้างย้อนหลัง ใช้ยอดงานค้างปัจจุบันเท่านั้น' })
  asOf?: string;
}
export class ChatCycleDetailsDto extends ChatAnalyticsQueryDto {
  @IsIn(CHAT_CYCLE_METRICS) metric: ChatCycleMetric = 'ALL';
}
export class ChatWorkDetailsDto extends ChatAnalyticsQueryDto {
  @IsIn(CHAT_WORK_METRICS) metric!: ChatWorkMetric;
}

export class ChatFunnelDetailsDto extends ChatAnalyticsQueryDto {
  @IsIn(JOURNEY_STAGES) stage: JourneyStage = 'CONTACTED';
  @IsIn(['reached', 'skipped', 'lost', 'all']) state: 'reached' | 'skipped' | 'lost' | 'all' =
    'reached';
}
