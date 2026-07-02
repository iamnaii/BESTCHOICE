import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LineOaChatbotController } from './line-oa-chatbot.controller';
import { LineOaService } from './line-oa.service';
import { ChatbotService } from './chatbot.service';
import { QuickReplyService } from './quick-reply.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { StorageService } from '../storage/storage.service';
import { WebhookDedupService } from '../chatbot-finance/services/webhook-dedup.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { QuickReplyPostbackRouterService } from '../staff-chat/services/quick-reply-postback-router.service';
import { AiAutoReplyService } from '../staff-chat/services/ai-auto-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';

const makeEvent = (text: string, userId = 'U-test') => ({
  type: 'message' as const,
  replyToken: 'rt-1',
  source: { type: 'user' as const, userId },
  message: { id: 'mid-1', type: 'text' as const, text },
});

describe('LineOaChatbotController — WS2 staged AI gate', () => {
  let controller: LineOaChatbotController;
  let lineOaService: any;
  let chatbotService: any;
  let messageRouter: any;
  let aiAutoReply: any;
  let envValues: Record<string, string | undefined>;

  beforeEach(async () => {
    envValues = {
      LINE_SHOP_AI_ENABLED: 'true',
      LINE_SHOP_AI_WHITELIST_USER_IDS: 'U-test',
    };
    lineOaService = {
      replyMessage: jest.fn().mockResolvedValue(undefined),
      findCustomerByLineId: jest.fn().mockResolvedValue({ name: 'สมชาย', contracts: [] }),
      selfLinkByPhone: jest.fn(),
    };
    chatbotService = { generateResponse: jest.fn().mockResolvedValue('คำตอบจากบอทเก่า') };
    messageRouter = {
      mirrorInbound: jest.fn().mockResolvedValue(undefined),
      routeInbound: jest.fn().mockResolvedValue(undefined),
    };
    aiAutoReply = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ aiAutoEnabled: true, aiAutoChannels: ['LINE_SHOP'] }),
    };

    const mod: TestingModule = await Test.createTestingModule({
      controllers: [LineOaChatbotController],
      providers: [
        { provide: LineOaService, useValue: lineOaService },
        { provide: ChatbotService, useValue: chatbotService },
        { provide: QuickReplyService, useValue: {} },
        { provide: RichMenuService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: PromptPayQrService, useValue: {} },
        { provide: PaymentLinkService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: WebhookDedupService, useValue: {} },
        { provide: MessageRouterService, useValue: messageRouter },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => envValues[k]) } },
        { provide: QuickReplyPostbackRouterService, useValue: {} },
        { provide: AiAutoReplyService, useValue: aiAutoReply },
        // LineWebhookGuard is attached via @UseGuards on handleWebhook — Nest
        // resolves its own constructor deps at module-compile time even
        // though these tests never hit that route.
        { provide: IntegrationConfigService, useValue: {} },
        { provide: WebhookAnomalyService, useValue: {} },
      ],
    }).compile();
    controller = mod.get(LineOaChatbotController);
  });

  const handleText = (text: string, userId?: string) =>
    (controller as any).handleTextMessage(makeEvent(text, userId));

  it('routes whitelisted freeform into routeInbound with replyToken (no mirror, no legacy bot)', async () => {
    await handleText('สนใจ iPhone 15 ครับ');
    expect(messageRouter.routeInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'LINE_SHOP',
        text: 'สนใจ iPhone 15 ครับ',
        replyToken: 'rt-1',
      }),
    );
    expect(messageRouter.mirrorInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).not.toHaveBeenCalled();
  });

  it('keyword commands keep the legacy deterministic path', async () => {
    await handleText('เช็คยอด');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(messageRouter.mirrorInbound).toHaveBeenCalled();
    expect(lineOaService.replyMessage).toHaveBeenCalled();
  });

  it('non-whitelisted user falls back to the legacy bot', async () => {
    await handleText('สนใจ iPhone', 'U-other');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).toHaveBeenCalled();
    expect(messageRouter.mirrorInbound).toHaveBeenCalled();
  });

  it('LINE_SHOP_AI_ENABLED!=true falls back to the legacy bot', async () => {
    envValues.LINE_SHOP_AI_ENABLED = 'false';
    await handleText('สนใจ iPhone');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).toHaveBeenCalled();
  });

  it('Settings checkbox off (autoChannels without LINE_SHOP) falls back to the legacy bot', async () => {
    aiAutoReply.getSettings.mockResolvedValue({
      aiAutoEnabled: true,
      aiAutoChannels: ['FACEBOOK'],
    });
    await handleText('สนใจ iPhone');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).toHaveBeenCalled();
  });

  it('getSettings failure falls back to the legacy bot (never silence)', async () => {
    aiAutoReply.getSettings.mockRejectedValue(new Error('db down'));
    await handleText('สนใจ iPhone');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).toHaveBeenCalled();
  });
});
