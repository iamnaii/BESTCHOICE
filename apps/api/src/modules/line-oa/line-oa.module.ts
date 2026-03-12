import { Module } from '@nestjs/common';
import { LineOaController } from './line-oa.controller';
import { LineOaService } from './line-oa.service';
import { LineWebhookGuard } from './line-webhook.guard';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { RichMenuService } from './rich-menu/rich-menu.service';

@Module({
  controllers: [LineOaController],
  providers: [
    LineOaService,
    LineWebhookGuard,
    PromptPayQrService,
    PaymentLinkService,
    RichMenuService,
  ],
  exports: [LineOaService, PromptPayQrService, PaymentLinkService, RichMenuService],
})
export class LineOaModule {}
