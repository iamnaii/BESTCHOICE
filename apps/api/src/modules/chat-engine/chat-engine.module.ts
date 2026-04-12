import { Module } from '@nestjs/common';
import { SessionManagerService } from './services/session-manager.service';
import { MessageRouterService } from './services/message-router.service';
import { HandoffManagerService } from './services/handoff-manager.service';
import { AssignmentService } from './services/assignment.service';
import { ConversationTagService } from './services/conversation-tag.service';
import { ChatCronService } from './services/chat-cron.service';
import { AfterHoursService } from './services/after-hours.service';

/**
 * ChatEngineModule — the foundation for the unified chat system.
 *
 * Provides channel-agnostic message routing, session management,
 * assignment, and handoff services. Channel adapters and domain
 * handlers are registered by other modules via the token-based
 * injection pattern (CHANNEL_ADAPTER_TOKEN, DOMAIN_HANDLER_TOKEN).
 *
 * Phase 1: Core services only (no adapters/handlers registered yet)
 * Phase 2: Adapters (Agent B) + Domain handlers (Agent D) + WS gateway (Agent C)
 */
@Module({
  providers: [
    SessionManagerService,
    MessageRouterService,
    HandoffManagerService,
    AssignmentService,
    ConversationTagService,
    ChatCronService,
    AfterHoursService,
  ],
  exports: [
    SessionManagerService,
    MessageRouterService,
    HandoffManagerService,
    AssignmentService,
    ConversationTagService,
    AfterHoursService,
  ],
})
export class ChatEngineModule {}
