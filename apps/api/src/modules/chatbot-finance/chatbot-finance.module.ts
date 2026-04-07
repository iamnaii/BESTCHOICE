import { Module } from '@nestjs/common';
import { ChatbotFinanceController } from './chatbot-finance.controller';
import { ChatbotFinanceService } from './services/chatbot-finance.service';
import { LineFinanceClientService } from './services/line-finance-client.service';
import { ChatSessionService } from './services/chat-session.service';
import { LineFinanceWebhookGuard } from './guards/line-finance-webhook.guard';

/**
 * Finance Bot Module ("น้องเบส")
 * Channel: LINE OA "ชำระค่างวด BESTCHOICE"
 *
 * Phase A1 (current): webhook skeleton + session/message persistence
 * Phase A2:           verification flow + AI service
 * Phase B+:           tools, vision, auto-trigger, handoff
 */
@Module({
  controllers: [ChatbotFinanceController],
  providers: [
    ChatbotFinanceService,
    LineFinanceClientService,
    ChatSessionService,
    LineFinanceWebhookGuard,
  ],
  exports: [LineFinanceClientService, ChatSessionService],
})
export class ChatbotFinanceModule {}
