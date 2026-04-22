import { Module } from '@nestjs/common';
import { ChatIntentRouterService } from './chat-intent-router.service';

@Module({
  providers: [ChatIntentRouterService],
  exports: [ChatIntentRouterService],
})
export class ChatIntentRouterModule {}
