import { Module } from '@nestjs/common';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { ChatAiDraftController } from './chat-ai-draft.controller';
import { ChatIntentRouterModule } from '../chat-intent-router/chat-intent-router.module';
import { SalesBotModule } from '../sales-bot/sales-bot.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';

@Module({
  imports: [ChatIntentRouterModule, SalesBotModule, ChatbotFinanceModule],
  controllers: [ChatAiDraftController],
  providers: [ChatAiDraftService],
  exports: [ChatAiDraftService],
})
export class ChatAiDraftModule {}
