import { Module } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { LineOaModule } from '../line-oa/line-oa.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';

@Module({
  imports: [LineOaModule, ChatbotFinanceModule],
  controllers: [BroadcastController],
  providers: [BroadcastService],
  exports: [BroadcastService],
})
export class BroadcastModule {}
