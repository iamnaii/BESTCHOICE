import { Module } from '@nestjs/common';
import { OverdueController } from './overdue.controller';
import { OverdueService } from './overdue.service';
import { OverdueChatService } from './overdue-chat.service';
import { ChatEngineModule } from '../chat-engine/chat-engine.module';

@Module({
  imports: [ChatEngineModule],
  controllers: [OverdueController],
  providers: [OverdueService, OverdueChatService],
  exports: [OverdueService],
})
export class OverdueModule {}
