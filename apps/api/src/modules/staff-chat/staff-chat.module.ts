import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StaffChatGateway } from './staff-chat.gateway';
import { StaffChatController } from './staff-chat.controller';
import { ChannelSettingsController } from './channel-settings.controller';
import { SideConversationController } from './side-conversation.controller';
import { StaffMessageService } from './services/staff-message.service';
import { CannedResponseVariableService } from './services/canned-response-variable.service';
import { PresenceService } from './services/presence.service';
import { CollisionDetectionService } from './services/collision-detection.service';
import { AiAssistantService } from './services/ai-assistant.service';
import { MediaContentService } from './services/media-content.service';
import { SideConversationService } from './services/side-conversation.service';
import { SnoozeService } from './services/snooze.service';
import { SnoozeCronService } from './services/snooze-cron.service';
import { SnoozeController } from './snooze.controller';
import { SessionOpsController } from './session-ops.controller';
import { SessionOpsService } from './services/session-ops.service';
import { ChatCommerceController } from './chat-commerce.controller';
import { ChatCommerceService } from './services/chat-commerce.service';
import { ChatEngineModule } from '../chat-engine/chat-engine.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';
import { PaySolutionsModule } from '../paysolutions/paysolutions.module';

/**
 * StaffChatModule — real-time staff chat interface.
 *
 * Provides:
 * - WebSocket gateway (/chat namespace) for real-time messaging
 * - REST controller for session management (assign, transfer, resolve, tags, notes)
 * - Presence tracking (online staff)
 * - Canned response access
 */
@Module({
  imports: [
    ChatEngineModule,
    PaySolutionsModule,
    forwardRef(() => ChatbotFinanceModule),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [StaffChatController, ChatCommerceController, ChannelSettingsController, SnoozeController, SessionOpsController, SideConversationController],
  providers: [StaffChatGateway, StaffMessageService, ChatCommerceService, CannedResponseVariableService, PresenceService, CollisionDetectionService, AiAssistantService, MediaContentService, SideConversationService, SnoozeService, SnoozeCronService, SessionOpsService],
  exports: [StaffChatGateway, PresenceService, CollisionDetectionService],
})
export class StaffChatModule {}
