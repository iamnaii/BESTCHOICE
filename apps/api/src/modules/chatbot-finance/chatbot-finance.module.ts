import { Module } from '@nestjs/common';
import { ChatbotFinanceController } from './chatbot-finance.controller';
import { ChatbotFinanceLiffController } from './chatbot-finance-liff.controller';
import { ChatbotFinanceService } from './services/chatbot-finance.service';
import { LineFinanceClientService } from './services/line-finance-client.service';
import { ChatSessionService } from './services/chat-session.service';
import { FinanceAiService } from './services/finance-ai.service';
import { VerificationService } from './services/verification.service';
import { LineFinanceWebhookGuard } from './guards/line-finance-webhook.guard';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Finance Bot Module ("น้องเบส")
 * Channel: LINE OA "ชำระค่างวด BESTCHOICE"
 *
 * Phase A1: webhook skeleton + session/message persistence ✅
 * Phase A2: verification (phone + OTP) + AI service (Claude) ✅
 * Phase B+: tools, vision, auto-trigger, handoff
 */
@Module({
  imports: [NotificationsModule], // reuse SMS service for OTP
  controllers: [ChatbotFinanceController, ChatbotFinanceLiffController],
  providers: [
    ChatbotFinanceService,
    LineFinanceClientService,
    ChatSessionService,
    FinanceAiService,
    VerificationService,
    LineFinanceWebhookGuard,
  ],
  exports: [LineFinanceClientService, ChatSessionService],
})
export class ChatbotFinanceModule {}
