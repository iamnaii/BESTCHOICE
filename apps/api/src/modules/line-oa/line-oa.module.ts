import { Module } from '@nestjs/common';
import { LineOaController } from './line-oa.controller';
import { LineOaChatbotController } from './line-oa-chatbot.controller';
import { LineOaPaymentController } from './line-oa-payment.controller';
import { LineOaCampaignController } from './line-oa-campaign.controller';
import { LiffApiController } from './liff-api.controller';
import { LineLoginController } from './line-login.controller';
import { LineOaService } from './line-oa.service';
import { LiffApiService } from './liff-api.service';
import { LineWebhookGuard } from './line-webhook.guard';
import { LiffTokenGuard } from './guards/liff-token.guard';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { ChatbotService } from './chatbot.service';
import { ShopDomainHandler } from './shop-domain.handler';
import { ContractsModule } from '../contracts/contracts.module';
import { PDPAModule } from '../pdpa/pdpa.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';

@Module({
  imports: [ContractsModule, PDPAModule, ChatbotFinanceModule],
  controllers: [LineOaController, LineOaChatbotController, LineOaPaymentController, LineOaCampaignController, LiffApiController, LineLoginController],
  providers: [
    LineOaService,
    LiffApiService,
    LineWebhookGuard,
    LiffTokenGuard,
    PromptPayQrService,
    PaymentLinkService,
    RichMenuService,
    ChatbotService,
    ShopDomainHandler,
  ],
  exports: [LineOaService, LiffApiService, PromptPayQrService, PaymentLinkService, RichMenuService, ShopDomainHandler],
})
export class LineOaModule {}
