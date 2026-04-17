import { Module, forwardRef } from '@nestjs/common';
import { LineOaController } from './line-oa.controller';
import { LineOaChatbotController } from './line-oa-chatbot.controller';
import { LineOaPaymentController } from './line-oa-payment.controller';
import { LineOaCampaignController } from './line-oa-campaign.controller';
import { LiffApiController } from './liff-api.controller';
import { LineLoginController } from './line-login.controller';
import { BroadcastController } from './broadcast.controller';
import { LineOaService } from './line-oa.service';
import { LiffApiService } from './liff-api.service';
import { LineWebhookGuard } from './line-webhook.guard';
import { LiffTokenGuard } from './guards/liff-token.guard';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { ChatbotService } from './chatbot.service';
import { QuickReplyService } from './quick-reply.service';
import { ShopDomainHandler } from './shop-domain.handler';
import { FlexTemplatesService } from './flex-templates.service';
import { BroadcastService } from './broadcast.service';
import { BroadcastCron } from './broadcast.cron';
import { ContractsModule } from '../contracts/contracts.module';
import { PDPAModule } from '../pdpa/pdpa.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ChatEngineModule } from '../chat-engine/chat-engine.module';

@Module({
  imports: [
    forwardRef(() => ContractsModule),
    PDPAModule,
    forwardRef(() => ChatbotFinanceModule),
    IntegrationsModule,
    forwardRef(() => ChatEngineModule),
  ],
  controllers: [LineOaController, LineOaChatbotController, LineOaPaymentController, LineOaCampaignController, LiffApiController, LineLoginController, BroadcastController],
  providers: [
    LineOaService,
    LiffApiService,
    LineWebhookGuard,
    LiffTokenGuard,
    PromptPayQrService,
    PaymentLinkService,
    RichMenuService,
    ChatbotService,
    QuickReplyService,
    ShopDomainHandler,
    FlexTemplatesService,
    BroadcastService,
    BroadcastCron,
  ],
  exports: [LineOaService, LiffApiService, PromptPayQrService, PaymentLinkService, RichMenuService, ShopDomainHandler, FlexTemplatesService, QuickReplyService],
})
export class LineOaModule {}
