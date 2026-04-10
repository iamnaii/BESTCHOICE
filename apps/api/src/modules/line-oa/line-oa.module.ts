import { Module } from '@nestjs/common';
import { LineOaController } from './line-oa.controller';
import { LineOaPaymentController } from './line-oa-payment.controller';
import { LineOaCampaignController } from './line-oa-campaign.controller';
import { LineOaService } from './line-oa.service';
import { LineWebhookGuard } from './line-webhook.guard';
import { LiffTokenGuard } from './guards/liff-token.guard';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { ChatbotService } from './chatbot.service';
import { ContractsModule } from '../contracts/contracts.module';
import { PDPAModule } from '../pdpa/pdpa.module';

@Module({
  imports: [ContractsModule, PDPAModule],
  controllers: [LineOaController, LineOaPaymentController, LineOaCampaignController],
  providers: [
    LineOaService,
    LineWebhookGuard,
    LiffTokenGuard,
    PromptPayQrService,
    PaymentLinkService,
    RichMenuService,
    ChatbotService,
  ],
  exports: [LineOaService, PromptPayQrService, PaymentLinkService, RichMenuService],
})
export class LineOaModule {}
