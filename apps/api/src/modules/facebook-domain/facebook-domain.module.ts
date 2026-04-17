import { Module, OnModuleInit } from '@nestjs/common';
import { FacebookDomainHandler } from './facebook-domain.handler';
import { FacebookQuickReplyService } from './facebook-quick-reply.service';
import { FacebookTemplateService } from './facebook-template.service';
import { FacebookPersistentMenuService } from './facebook-persistent-menu.service';
import { DOMAIN_HANDLER_TOKEN } from '../chat-engine/interfaces/domain-handler.interface';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { ChatEngineModule } from '../chat-engine/chat-engine.module';

/**
 * FacebookDomainModule — handles Facebook Messenger business logic.
 *
 * Provides:
 * - FacebookDomainHandler (registered as DOMAIN_HANDLER_TOKEN)
 * - FacebookQuickReplyService (6 button sets)
 * - FacebookTemplateService (7 template builders)
 * - FacebookPersistentMenuService (persistent menu setup)
 */
@Module({
  imports: [ChatEngineModule],
  providers: [
    FacebookDomainHandler,
    FacebookQuickReplyService,
    FacebookTemplateService,
    FacebookPersistentMenuService,
    {
      provide: DOMAIN_HANDLER_TOKEN,
      useExisting: FacebookDomainHandler,
    },
  ],
  exports: [
    FacebookDomainHandler,
    FacebookQuickReplyService,
    FacebookTemplateService,
    FacebookPersistentMenuService,
    DOMAIN_HANDLER_TOKEN,
  ],
})
export class FacebookDomainModule implements OnModuleInit {
  constructor(
    private messageRouter: MessageRouterService,
    private facebookHandler: FacebookDomainHandler,
  ) {}

  onModuleInit(): void {
    this.messageRouter.registerDomainHandler(this.facebookHandler);
  }
}
