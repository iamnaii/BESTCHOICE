import { Module } from '@nestjs/common';
import { ChatAnalyticsController } from './chat-analytics.controller';
import { ChatAnalyticsService } from './chat-analytics.service';

@Module({
  controllers: [ChatAnalyticsController],
  providers: [ChatAnalyticsService],
  exports: [ChatAnalyticsService],
})
export class ChatAnalyticsModule {}
