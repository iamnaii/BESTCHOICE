import { Module } from '@nestjs/common';
import { LineFinanceAdapter } from './line-finance.adapter';
import { LineShopAdapter } from './line-shop.adapter';
import { FacebookAdapter } from './facebook.adapter';
import { TiktokAdapter } from './tiktok.adapter';
import { WebWidgetAdapter } from './web-widget.adapter';
import { CHANNEL_ADAPTER_TOKEN } from '../chat-engine/interfaces/channel-adapter.interface';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';
import { LineOaModule } from '../line-oa/line-oa.module';

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
  imports: [ChatbotFinanceModule, LineOaModule],
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
export class ChatAdaptersModule {}
