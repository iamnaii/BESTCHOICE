import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiAutoReplyService } from '../ai-auto-reply.service';
import { AiSuggestService } from '../ai-suggest.service';
import { SalesBotService } from '../../../sales-bot/sales-bot.service';
import { LlmProviderRegistry } from '../../../sales-bot/providers/llm-provider.registry';
import { PrismaService } from '../../../../prisma/prisma.service';

describe('SHOP AI integration — autoReply with SalesBot mock', () => {
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
        { provide: SalesBotService, useValue: salesBot },
        { provide: LlmProviderRegistry, useValue: { invalidateCache: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(AiAutoReplyService);
  });

  it('passes through SalesBot reply with tools/tokens', async () => {
    salesBot.generateReply.mockResolvedValue({
      reply: '3 แพ็คผ่อน iPhone 15: ...',
      confidence: 0.95,
      toolsUsed: ['search_products', 'calculate_installment'],
      inputTokens: 200,
      outputTokens: 100,
    });

    const result = await svc.autoReply('room-int', 'iPhone 15 ผ่อนเท่าไหร่');

    expect(result).toEqual(
      expect.objectContaining({
        reply: expect.stringContaining('iPhone 15'),
        confidence: 0.95,
        toolsUsed: ['search_products', 'calculate_installment'],
        inputTokens: 200,
        outputTokens: 100,
      }),
    );
  });

  it('returns null when SalesBot calls handoff (confidence below threshold)', async () => {
    salesBot.generateReply.mockResolvedValue({
      reply: 'ขออนุญาตเรียกแอดมิน',
      confidence: 0.3,
      toolsUsed: ['handoff_to_human'],
      inputTokens: 80,
      outputTokens: 40,
    });

    const result = await svc.autoReply('room-int', 'ขอผ่อน 5 เครื่อง');
    expect(result).toBeNull();
  });
});
