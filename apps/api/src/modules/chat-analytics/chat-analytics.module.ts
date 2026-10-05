import { ChatAnalyticsV2Service } from './chat-analytics-v2.service';
import { ChatWorkAccessService } from '../staff-chat/services/chat-work-access.service';
import { Module } from '@nestjs/common';
import { ChatAnalyticsController } from './chat-analytics.controller';
import { ChatAnalyticsService } from './chat-analytics.service';

@Module({
  controllers: [ChatAnalyticsController],
  providers: [ChatAnalyticsService, ChatAnalyticsV2Service, ChatWorkAccessService],
  exports: [ChatAnalyticsService],
})
export class ChatAnalyticsModule {}
