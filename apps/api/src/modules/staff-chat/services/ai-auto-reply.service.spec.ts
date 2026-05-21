import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiAutoReplyService } from './ai-auto-reply.service';
import { AiSuggestService } from './ai-suggest.service';
import { SalesBotService } from '../../sales-bot/sales-bot.service';
import { LlmProviderRegistry } from '../../sales-bot/providers/llm-provider.registry';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { PersonaService } from './persona.service';
import { PrismaService } from '../../../prisma/prisma.service';

const makeLlmRegistryMock = () => ({ invalidateCache: jest.fn() });
const makePersonaMock = () => ({
  getBase: jest.fn().mockResolvedValue('base'),
  getBotExtras: jest.fn().mockResolvedValue('extras'),
  getBot: jest.fn().mockResolvedValue('base+extras'),
  invalidateCache: jest.fn(),
  isCustomized: jest.fn().mockResolvedValue({ base: false, extras: false }),
});

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
        { provide: LlmProviderRegistry, useValue: makeLlmRegistryMock() },
        { provide: PersonaService, useValue: makePersonaMock() },
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
        { provide: LlmProviderRegistry, useValue: makeLlmRegistryMock() },
        { provide: PersonaService, useValue: makePersonaMock() },
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
        { provide: LlmProviderRegistry, useValue: makeLlmRegistryMock() },
        { provide: PersonaService, useValue: makePersonaMock() },
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

describe('AiAutoReplyService.llmProvider — get + update + cache invalidation', () => {
  let svc: AiAutoReplyService;
  let prisma: any;
  let llmRegistry: { invalidateCache: jest.Mock };
  let persona: ReturnType<typeof makePersonaMock>;

  beforeEach(async () => {
    llmRegistry = makeLlmRegistryMock();
    persona = makePersonaMock();
    prisma = {
      systemConfig: {
        findMany: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiAutoReplyService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaService, useValue: prisma },
        { provide: AiSuggestService, useValue: {} },
        { provide: SalesBotService, useValue: {} },
        { provide: MessageRouterService, useValue: { getAdapter: jest.fn() } },
        { provide: LlmProviderRegistry, useValue: llmRegistry },
        { provide: PersonaService, useValue: persona },
      ],
    }).compile();
    svc = mod.get(AiAutoReplyService);
  });

  it('getSettings defaults llmProvider to "claude" when config row absent', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([]);
    const s = await svc.getSettings();
    expect(s.llmProvider).toBe('claude');
  });

  it('getSettings returns "gemini" when shop_bot_llm_provider=gemini', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_llm_provider', value: 'gemini' },
    ]);
    const s = await svc.getSettings();
    expect(s.llmProvider).toBe('gemini');
  });

  it('getSettings is case-insensitive — "GEMINI" still parses as gemini', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_llm_provider', value: 'GEMINI' },
    ]);
    const s = await svc.getSettings();
    expect(s.llmProvider).toBe('gemini');
  });

  it('getSettings falls back to "claude" on unknown value (matches registry behavior)', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_llm_provider', value: 'llama' },
    ]);
    const s = await svc.getSettings();
    expect(s.llmProvider).toBe('claude');
  });

  it('updateSettings({llmProvider: "gemini"}) upserts SystemConfig + invalidates registry cache', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_llm_provider', value: 'gemini' },
    ]);
    await svc.updateSettings({ llmProvider: 'gemini' });
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'shop_bot_llm_provider' },
        create: expect.objectContaining({ key: 'shop_bot_llm_provider', value: 'gemini' }),
        update: expect.objectContaining({ value: 'gemini' }),
      }),
    );
    expect(llmRegistry.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('updateSettings without llmProvider does NOT invalidate cache (no LLM-touching change)', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([]);
    await svc.updateSettings({ aiAutoEnabled: true });
    expect(llmRegistry.invalidateCache).not.toHaveBeenCalled();
  });

  // Regression — 2026-05-21 prod incident.
  // Saving SHOP Bot Setup with empty PromptPay / Test userId inputs sent
  // `shopBotPromptpayId: null`, which the old `!== undefined` guard let pass
  // through to prisma.systemConfig.upsert with `value: null`. Prisma rejected
  // (SystemConfig.value is non-nullable) and the whole PATCH returned 500.
  // Fix: skip null entries so the previously-saved value stays intact.
  it('updateSettings skips entries where value is null (does not crash upsert)', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([]);
    await svc.updateSettings({
      shopBotCentralBranchId: 'branch-uuid',
      shopBotPromptpayId: null as unknown as string, // simulating frontend `|| null`
      shopBotTestUserId: null as unknown as string,
      llmProvider: 'gemini',
    });
    const calls = prisma.systemConfig.upsert.mock.calls.map(
      (c: any[]) => c[0].where.key as string,
    );
    expect(calls).toContain('shop_bot_central_branch_id');
    expect(calls).toContain('shop_bot_llm_provider');
    expect(calls).not.toContain('shop_bot_promptpay_id');
    expect(calls).not.toContain('shop_bot_test_user_id');
    // Cache invalidation still happens because llmProvider was non-null in this patch.
    expect(llmRegistry.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('updateSettings with all-null llmProvider does NOT invalidate cache', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([]);
    await svc.updateSettings({ llmProvider: null as unknown as 'claude' });
    expect(llmRegistry.invalidateCache).not.toHaveBeenCalled();
  });

  // Persona editor flow — see DTO sentinel docstring for the three states:
  // undefined/null = skip, '' = revert (soft-delete row), non-empty = upsert.
  describe('persona fields', () => {
    it('non-empty BASE → upsert + invalidate persona cache', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await svc.updateSettings({ shopBotPersonaBase: 'new BASE prompt' });
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'shop_bot_persona_base' },
          create: expect.objectContaining({
            key: 'shop_bot_persona_base',
            value: 'new BASE prompt',
          }),
        }),
      );
      expect(persona.invalidateCache).toHaveBeenCalledTimes(1);
      expect(prisma.systemConfig.updateMany).not.toHaveBeenCalled();
    });

    it('non-empty BOT_EXTRAS → upsert + invalidate', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await svc.updateSettings({ shopBotPersonaBotExtras: '\n\n# my playbook' });
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'shop_bot_persona_bot_extras' },
        }),
      );
      expect(persona.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('empty-string BASE → soft-delete row + invalidate (revert sentinel)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await svc.updateSettings({ shopBotPersonaBase: '' });
      expect(prisma.systemConfig.updateMany).toHaveBeenCalledWith({
        where: { key: { in: ['shop_bot_persona_base'] }, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      // Empty-string is NOT a regular upsert
      const upsertCalls = prisma.systemConfig.upsert.mock.calls.filter(
        (c: any[]) => c[0].where.key === 'shop_bot_persona_base',
      );
      expect(upsertCalls).toHaveLength(0);
      expect(persona.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('empty-string BOTH → soft-delete both rows in one updateMany', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await svc.updateSettings({
        shopBotPersonaBase: '',
        shopBotPersonaBotExtras: '',
      });
      expect(prisma.systemConfig.updateMany).toHaveBeenCalledWith({
        where: {
          key: { in: ['shop_bot_persona_base', 'shop_bot_persona_bot_extras'] },
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date) },
      });
      expect(persona.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('mixed: upsert one + revert the other in same call', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await svc.updateSettings({
        shopBotPersonaBase: 'new BASE',
        shopBotPersonaBotExtras: '',
      });
      // BASE upserted
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'shop_bot_persona_base' } }),
      );
      // EXTRAS soft-deleted
      expect(prisma.systemConfig.updateMany).toHaveBeenCalledWith({
        where: {
          key: { in: ['shop_bot_persona_bot_extras'] },
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date) },
      });
      expect(persona.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('absent persona fields → no upsert, no updateMany, no invalidate (null-skip)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await svc.updateSettings({ aiAutoEnabled: true });
      expect(persona.invalidateCache).not.toHaveBeenCalled();
      expect(prisma.systemConfig.updateMany).not.toHaveBeenCalled();
    });

    it('explicit-null persona fields → skipped (matches PR #1059 pattern)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([]);
      await svc.updateSettings({
        shopBotPersonaBase: null as unknown as string,
        shopBotPersonaBotExtras: null as unknown as string,
      });
      expect(persona.invalidateCache).not.toHaveBeenCalled();
      expect(prisma.systemConfig.updateMany).not.toHaveBeenCalled();
      const personaUpserts = prisma.systemConfig.upsert.mock.calls.filter(
        (c: any[]) =>
          c[0].where.key === 'shop_bot_persona_base' ||
          c[0].where.key === 'shop_bot_persona_bot_extras',
      );
      expect(personaUpserts).toHaveLength(0);
    });
  });
});
