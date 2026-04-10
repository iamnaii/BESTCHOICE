import { Module } from '@nestjs/common';
import { ChatbotFinanceController } from './chatbot-finance.controller';
import { ChatbotFinanceLiffController } from './chatbot-finance-liff.controller';
import { ChatbotFinanceAdminController } from './chatbot-finance-admin.controller';
import { ChatbotFinanceService } from './services/chatbot-finance.service';
import { LineFinanceClientService } from './services/line-finance-client.service';
import { ChatSessionService } from './services/chat-session.service';
import { FinanceAiService } from './services/finance-ai.service';
import { FinanceToolsService } from './services/finance-tools.service';
import { KnowledgeService } from './services/knowledge.service';
import { HandoffService } from './services/handoff.service';
import { VisionService } from './services/vision.service';
import { SlipProcessingService } from './services/slip-processing.service';
import { AutoTriggerService } from './services/auto-trigger.service';
import { LineStaffClientService } from './services/line-staff-client.service';
import { StaffNotificationService } from './services/staff-notification.service';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { FinanceConfigService } from './services/finance-config.service';
import { FinanceToolExecutor } from './tools/tool-executor';
import { VerificationService } from './services/verification.service';
import { FeedbackService } from './services/feedback.service';
import { LearningService } from './services/learning.service';
import { WeeklyAnalysisService } from './services/weekly-analysis.service';
import { LineFinanceWebhookGuard } from './guards/line-finance-webhook.guard';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Finance Bot Module ("น้องเบส")
 * Channel: LINE OA "ชำระค่างวด BESTCHOICE"
 *
 * Phases (all complete):
 *   A1 ✅ webhook + session/message persistence
 *   A2 ✅ verification (LIFF + SMS OTP, DB-backed) + AI service
 *   A3 ✅ Staff LINE OA notifications (handoff + slip review)
 *   B  ✅ Claude tools (5 data + KB search + handoff)
 *   C  ✅ vision-based slip processing → PaymentEvidence
 *   D  ✅ auto-trigger reminders cron (T-5/-3/-1/0, T+1/+3)
 *   E  ✅ admin endpoints + analytics/sessions/KB UI
 */
@Module({
  imports: [NotificationsModule], // SMS for OTP
  controllers: [
    ChatbotFinanceController,
    ChatbotFinanceLiffController,
    ChatbotFinanceAdminController,
  ],
  providers: [
    ChatbotFinanceService,
    LineFinanceClientService,
    ChatSessionService,
    FinanceAiService,
    FinanceToolsService,
    KnowledgeService,
    HandoffService,
    VisionService,
    SlipProcessingService,
    AutoTriggerService,
    LineStaffClientService,
    StaffNotificationService,
    AdminAnalyticsService,
    FinanceConfigService,
    FinanceToolExecutor,
    VerificationService,
    FeedbackService,
    LearningService,
    WeeklyAnalysisService,
    LineFinanceWebhookGuard,
  ],
  exports: [LineFinanceClientService, ChatSessionService, VerificationService],
})
export class ChatbotFinanceModule {}
