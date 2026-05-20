import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiAutoReplyService } from './ai-auto-reply.service';
import { AiSuggestService } from './ai-suggest.service';
import { SalesBotService } from '../../sales-bot/sales-bot.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AiAutoReplyService.shouldAutoReply', () => {
  let svc: AiAutoReplyService;
  let prisma: { systemConfig: any; aiAutoReplyLog: any };

  beforeEach(async () => {
    prisma = {
      systemConfig: { findMany: jest.fn().mockResolvedValue([
        { key: 'ai.autoEnabled', value: 'true' },
        { key: 'ai.autoChannels', value: '["LINE_SHOP"]' },
        { key: 'ai.autoMaxRepliesPerSession', value: '50' },
      ]) },
      aiAutoReplyLog: { count: jest.fn().mockResolvedValue(0) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiAutoReplyService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaService, useValue: prisma },
        { provide: AiSuggestService, useValue: {} },
        { provide: SalesBotService, useValue: { generateReply: jest.fn() } },
        { provide: MessageRouterService, useValue: { getAdapter: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(AiAutoReplyService);
  });

  it('returns false when room.aiPaused is true', async () => {
    const session = { id: 'r1', channel: 'LINE_SHOP', aiPaused: true, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });

  it('returns false when room.handoffMode is true', async () => {
    const session = { id: 'r1', channel: 'LINE_SHOP', aiPaused: false, handoffMode: true };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });

  it('returns true for active LINE_SHOP room', async () => {
    const session = { id: 'r1', channel: 'LINE_SHOP', aiPaused: false, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(true);
  });

  it('returns false when shop_bot_central_branch_id is not configured', async () => {
    prisma.systemConfig.findMany
      .mockResolvedValueOnce([
        { key: 'ai.autoEnabled', value: 'true' },
        { key: 'ai.autoChannels', value: '["LINE_SHOP"]' },
        { key: 'ai.autoMaxRepliesPerSession', value: '50' },
      ])
      .mockResolvedValueOnce([]); // shop_bot_central_branch_id missing
    const session = { id: 'r-c', channel: 'LINE_SHOP', aiPaused: false, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });

  it('returns false for TIKTOK channel even if in aiAutoChannels allowlist (adapter is stub)', async () => {
    prisma.systemConfig.findMany.mockResolvedValueOnce([
      { key: 'ai.autoEnabled', value: 'true' },
      { key: 'ai.autoChannels', value: '["LINE_SHOP","TIKTOK"]' },
      { key: 'ai.autoMaxRepliesPerSession', value: '50' },
    ]);
    const session = { id: 'r-tt', channel: 'TIKTOK', aiPaused: false, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });
});

describe('AiAutoReplyService.autoReply', () => {
  let svc: AiAutoReplyService;
  let salesBot: { generateReply: jest.Mock };
  let prisma: any;

  beforeEach(async () => {
    salesBot = { generateReply: jest.fn() };
    prisma = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue({ customerId: null }) },
      chatMessage: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findMany: jest.fn().mockResolvedValue([
        { key: 'ai.autoConfidenceThreshold', value: '80' },
      ]) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiAutoReplyService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaService, useValue: prisma },
        { provide: AiSuggestService, useValue: { suggest: jest.fn() } },
        // NEW dep: SalesBotService
        { provide: SalesBotService, useValue: salesBot },
        { provide: MessageRouterService, useValue: { getAdapter: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(AiAutoReplyService);
  });

  it('uses SalesBotService and returns reply when confidence >= threshold', async () => {
    salesBot.generateReply.mockResolvedValue({
      reply: 'iPhone 15 ราคา 28,900 บาทค่ะ ดาวน์เริ่ม 490',
      confidence: 0.95,
      toolsUsed: ['calculate_installment'],
      inputTokens: 100,
      outputTokens: 50,
    });

    const result = await svc.autoReply('room-1', 'iPhone 15 ราคา?');

    expect(salesBot.generateReply).toHaveBeenCalledWith(expect.objectContaining({
      text: 'iPhone 15 ราคา?',
      roomId: 'room-1',
    }));
    expect(result).toEqual(expect.objectContaining({
      reply: expect.stringContaining('iPhone 15'),
      confidence: 0.95,
    }));
  });

  it('returns null when confidence < threshold', async () => {
    salesBot.generateReply.mockResolvedValue({
      reply: 'ขออนุญาตเรียกแอดมิน',
      confidence: 0.3,
      toolsUsed: ['handoff_to_human'],
      inputTokens: 50,
      outputTokens: 30,
    });
    const result = await svc.autoReply('room-2', 'ขอผ่อน iPhone 5 เครื่อง');
    expect(result).toBeNull();
  });
});

describe('AiAutoReplyService.testSend', () => {
  let svc: AiAutoReplyService;
  let prisma: any;
  let adapter: { channel: string; sendMessage: jest.Mock };
  let messageRouter: { getAdapter: jest.Mock };

  beforeEach(async () => {
    adapter = {
      channel: 'LINE_SHOP',
      sendMessage: jest.fn(),
    };
    messageRouter = {
      getAdapter: jest.fn().mockReturnValue(adapter),
    };
    prisma = {
      systemConfig: { findMany: jest.fn() },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiAutoReplyService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaService, useValue: prisma },
        { provide: AiSuggestService, useValue: {} },
        { provide: SalesBotService, useValue: {} },
        { provide: MessageRouterService, useValue: messageRouter },
      ],
    }).compile();
    svc = mod.get(AiAutoReplyService);
  });

  it('returns error when shop_bot_test_user_id is not configured', async () => {
    // getSettings will return shopBotTestUserId: null when key absent
    prisma.systemConfig.findMany.mockResolvedValue([]);

    const result = await svc.testSend();

    expect(result.success).toBe(false);
    expect(result.error).toContain('ยังไม่ตั้งค่า');
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });

  it('sends test message via LINE_SHOP adapter and returns success', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_test_user_id', value: 'U-line-test' },
    ]);
    adapter.sendMessage.mockResolvedValue({ success: true });

    const result = await svc.testSend();

    expect(result.success).toBe(true);
    expect(messageRouter.getAdapter).toHaveBeenCalledWith('LINE_SHOP');
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserId: 'U-line-test',
        channel: 'LINE_SHOP',
        text: expect.stringContaining('🧪'),
      }),
    );
  });

  it('returns adapter error when sendMessage fails', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_test_user_id', value: 'U-line-test' },
    ]);
    adapter.sendMessage.mockResolvedValue({ success: false, error: 'token invalid' });

    const result = await svc.testSend();

    expect(result.success).toBe(false);
    expect(result.error).toBe('token invalid');
  });
});
