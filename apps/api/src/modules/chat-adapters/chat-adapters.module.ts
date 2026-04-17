import { Module, OnModuleInit } from '@nestjs/common';
import { LineFinanceAdapter } from './line-finance.adapter';
import { LineShopAdapter } from './line-shop.adapter';
import { FacebookAdapter } from './facebook.adapter';
import { TiktokAdapter } from './tiktok.adapter';
import { WebWidgetAdapter } from './web-widget.adapter';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { CHANNEL_ADAPTER_TOKEN } from '../chat-engine/interfaces/channel-adapter.interface';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { ChatEngineModule } from '../chat-engine/chat-engine.module';
import { FacebookDomainModule } from '../facebook-domain/facebook-domain.module';
import { MessageRouterService } from '../chat-engine/services/message-router.service';

/**
 * ChatAdaptersModule — provides IChannelAdapter implementations for all channels.
 *
 * Each adapter wraps an existing platform client (LINE Finance, LINE Shop)
 * or implements the platform API directly (Facebook, TikTok, Web).
 *
 * The adapters are registered via CHANNEL_ADAPTER_TOKEN so the ChatEngine
 * can collect and route messages through them.
 */
@Module({
  imports: [ChatbotFinanceModule, LineOaModule, ChatEngineModule, FacebookDomainModule],
  controllers: [FacebookWebhookController],
  providers: [
    LineFinanceAdapter,
    LineShopAdapter,
    FacebookAdapter,
    TiktokAdapter,
    WebWidgetAdapter,
    {
      provide: CHANNEL_ADAPTER_TOKEN,
      useFactory: (
        lineFin: LineFinanceAdapter,
        lineShop: LineShopAdapter,
        fb: FacebookAdapter,
        tiktok: TiktokAdapter,
        web: WebWidgetAdapter,
      ) => [lineFin, lineShop, fb, tiktok, web],
      inject: [
        LineFinanceAdapter,
        LineShopAdapter,
        FacebookAdapter,
        TiktokAdapter,
        WebWidgetAdapter,
      ],
    },
  ],
  exports: [
    CHANNEL_ADAPTER_TOKEN,
    LineFinanceAdapter,
    LineShopAdapter,
    FacebookAdapter,
    TiktokAdapter,
    WebWidgetAdapter,
  ],
})
export class ChatAdaptersModule implements OnModuleInit {
  constructor(
    private messageRouter: MessageRouterService,
    private lineFinance: LineFinanceAdapter,
    private lineShop: LineShopAdapter,
    private facebook: FacebookAdapter,
    private tiktok: TiktokAdapter,
    private web: WebWidgetAdapter,
  ) {}

  onModuleInit(): void {
    this.messageRouter.registerAdapter(this.lineFinance);
    this.messageRouter.registerAdapter(this.lineShop);
    this.messageRouter.registerAdapter(this.facebook);
    this.messageRouter.registerAdapter(this.tiktok);
    this.messageRouter.registerAdapter(this.web);
  }
}
