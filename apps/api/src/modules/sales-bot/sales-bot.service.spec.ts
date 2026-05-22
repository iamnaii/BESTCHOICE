import { Test } from '@nestjs/testing';
import { SalesBotService } from './sales-bot.service';
import { SearchProductsTool } from './tools/search-products.tool';
import { CalculateInstallmentTool } from './tools/calculate-installment.tool';
import { ListPromotionsTool } from './tools/list-promotions.tool';
import { HandoffToHumanTool } from './tools/handoff-to-human.tool';
import { CaptureLeadTool } from './tools/capture-lead.tool';
import { LlmProviderRegistry } from './providers/llm-provider.registry';
import { PersonaService } from '../staff-chat/services/persona.service';
import {
  ILlmProvider,
  LlmChatResponse,
} from './providers/llm-provider.interface';

describe('SalesBotService', () => {
  async function build(chatMock: jest.Mock) {
    const fakeProvider: ILlmProvider = {
      providerName: 'claude',
      chat: chatMock as unknown as (...args: any[]) => Promise<LlmChatResponse>,
    };
    const registry = { getActive: jest.fn().mockResolvedValue(fakeProvider) };
    const searchProducts = { run: jest.fn() };
    const calcInstallment = { run: jest.fn() };
    const listPromotions = { run: jest.fn() };
    const handoff = { run: jest.fn() };
    const captureLead = { run: jest.fn() };
    const persona = {
      getBase: jest.fn().mockResolvedValue('test-base'),
      getBotExtras: jest.fn().mockResolvedValue('-extras'),
      getBot: jest.fn().mockResolvedValue('test-bot-prompt'),
      invalidateCache: jest.fn(),
      isCustomized: jest.fn().mockResolvedValue({ base: false, extras: false }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SalesBotService,
        { provide: LlmProviderRegistry, useValue: registry },
        { provide: SearchProductsTool, useValue: searchProducts },
        { provide: CalculateInstallmentTool, useValue: calcInstallment },
        { provide: ListPromotionsTool, useValue: listPromotions },
        { provide: HandoffToHumanTool, useValue: handoff },
        { provide: CaptureLeadTool, useValue: captureLead },
        { provide: PersonaService, useValue: persona },
      ],
    }).compile();
    const svc = mod.get(SalesBotService);
    return {
      svc,
      registry,
      searchProducts,
      calcInstallment,
      listPromotions,
      handoff,
      captureLead,
    };
  }

  it('returns reply without tool calls when provider answers directly', async () => {
    const chat = jest.fn().mockResolvedValue({
      text: 'สวัสดีค่ะ สนใจรุ่นไหนคะ',
      toolCalls: [],
      inputTokens: 100,
      outputTokens: 20,
      modelName: 'claude-sonnet-4-6',
    } satisfies LlmChatResponse);
    const { svc } = await build(chat);
    const result = await svc.generateReply({
      text: 'สวัสดีครับ',
      roomId: 'r1',
      customerId: null,
    });
    expect(result.reply).toContain('สวัสดี');
    expect(result.toolsUsed).toHaveLength(0);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(20);
    expect(result.modelUsed).toBe('claude-sonnet-4-6');
  });

  it('runs a tool and feeds the result back for a second turn', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { id: 'tu_1', name: 'search_products', input: { query: 'iPhone 15' } },
        ],
        inputTokens: 120,
        outputTokens: 30,
        modelName: 'claude-sonnet-4-6',
      } satisfies LlmChatResponse)
      .mockResolvedValueOnce({
        text: 'มี iPhone 15 ในสต็อกค่ะ ราคา 32,900 บาท',
        toolCalls: [],
        inputTokens: 140,
        outputTokens: 40,
        modelName: 'claude-sonnet-4-6',
      } satisfies LlmChatResponse);
    const { svc, searchProducts } = await build(chat);
    searchProducts.run.mockResolvedValue({
      products: [{ id: 'p1', name: 'iPhone 15', priceThb: 32900 }],
    });
    const result = await svc.generateReply({
      text: 'iPhone 15 กี่บาท',
      roomId: 'r1',
      customerId: null,
    });
    expect(searchProducts.run).toHaveBeenCalledWith({ query: 'iPhone 15' });
    expect(result.toolsUsed).toEqual(['search_products']);
    expect(result.reply).toContain('32,900');
    expect(result.inputTokens).toBe(260);
    expect(result.outputTokens).toBe(70);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('lowers confidence when handoff_to_human is called', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          {
            id: 'tu_h',
            name: 'handoff_to_human',
            input: { reason: 'customer_wants_staff', roomId: 'r1' },
          },
        ],
        inputTokens: 80,
        outputTokens: 10,
        modelName: 'claude-sonnet-4-6',
      } satisfies LlmChatResponse)
      .mockResolvedValueOnce({
        text: 'ส่งเรื่องให้พี่ staff แล้วค่ะ รอสักครู่นะคะ',
        toolCalls: [],
        inputTokens: 90,
        outputTokens: 15,
        modelName: 'claude-sonnet-4-6',
      } satisfies LlmChatResponse);
    const { svc, handoff } = await build(chat);
    handoff.run.mockResolvedValue({ handoffAccepted: true });
    const result = await svc.generateReply({
      text: 'ขอคุยกับคนได้ไหม',
      roomId: 'r1',
      customerId: null,
    });
    // handoff.run is called with roomId injected by the service, regardless
    // of what the model passed in its input.
    expect(handoff.run).toHaveBeenCalledWith({
      reason: 'customer_wants_staff',
      roomId: 'r1',
    });
    expect(result.toolsUsed).toEqual(['handoff_to_human']);
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });

  it('falls back to staff message after 3 unresolved hops', async () => {
    const chat = jest.fn().mockResolvedValue({
      text: '',
      toolCalls: [
        { id: 'tu_loop', name: 'search_products', input: { query: 'x' } },
      ],
      inputTokens: 50,
      outputTokens: 5,
      modelName: 'claude-sonnet-4-6',
    } satisfies LlmChatResponse);
    const { svc, searchProducts } = await build(chat);
    searchProducts.run.mockResolvedValue({ products: [] });
    const result = await svc.generateReply({
      text: '???',
      roomId: 'r1',
      customerId: null,
    });
    expect(result.reply).toContain('staff');
    expect(result.confidence).toBeLessThanOrEqual(0.3);
    // 3 hops × 1 tool call each.
    expect(searchProducts.run).toHaveBeenCalledTimes(3);
  });

  describe('estimateConfidence (reworked)', () => {
    // Use bracket-access for the private method (already pattern in some specs)
    const svc = new SalesBotService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any, // PersonaService — unused by the private estimateConfidence path
    );

    it('greeting/qualifier (no tool, complete sentence) → 0.9', () => {
      const c = (svc as any).estimateConfidence('สวัสดีค่ะพี่ สนใจรุ่นไหนคะ?', []);
      expect(c).toBe(0.9);
    });

    it('tool-used reply → 0.95', () => {
      const c = (svc as any).estimateConfidence('iPhone 15 ราคา 28,900 ค่ะ', ['calculate_installment']);
      expect(c).toBe(0.95);
    });

    it('short/incomplete reply → 0.6', () => {
      const c = (svc as any).estimateConfidence('ค่ะ', []);
      expect(c).toBe(0.6);
    });

    it('handoff_to_human used → 0.3', () => {
      const c = (svc as any).estimateConfidence('ขออนุญาตเรียกแอดมินมาช่วยตอบนะคะ', ['handoff_to_human']);
      expect(c).toBe(0.3);
    });
  });

  // Regression coverage for the 2026-05-21 Nai 7,000 hallucination: Gemini 2.5
  // ignored anti-hallucinate persona rules in PR #1064 and reported "iPhone 15
  // 7,000 บาท" though the tool returned only iPhone 13/16 at 14,691/17,000.
  // The guard catches this without depending on model behaviour.
  it('blocks reply with hallucinated price not seen in any tool result', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { id: 'tu_1', name: 'search_products', input: { query: 'iPhone' } },
        ],
        inputTokens: 100,
        outputTokens: 10,
        modelName: 'gemini-2.5-flash',
      } satisfies LlmChatResponse)
      .mockResolvedValueOnce({
        // Hallucinated reply: tool only returned 14,691 + 17,000.
        text: 'iPhone 15 ราคาเริ่มต้น 7,000 บาทค่ะ',
        toolCalls: [],
        inputTokens: 120,
        outputTokens: 25,
        modelName: 'gemini-2.5-flash',
      } satisfies LlmChatResponse);
    const { svc, searchProducts } = await build(chat);
    searchProducts.run.mockResolvedValue({
      products: [
        { id: 'p1', name: 'iPhone 13', priceThb: 14691 },
        { id: 'p2', name: 'iPhone 16', priceThb: 17000 },
      ],
    });
    const result = await svc.generateReply({
      text: 'iPhone 15 มีไหม',
      roomId: 'r1',
      customerId: null,
    });
    // Should NOT auto-send the hallucinated reply — force handoff instead.
    expect(result.reply).not.toContain('7,000');
    expect(result.reply).toContain('staff');
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });

  it('accepts reply citing a price within ±5% of a grounded tool result', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { id: 'tu_1', name: 'search_products', input: { query: 'iPhone' } },
        ],
        inputTokens: 100,
        outputTokens: 10,
        modelName: 'claude-sonnet-4-6',
      } satisfies LlmChatResponse)
      .mockResolvedValueOnce({
        // Tool returned 14,691; reply says 14,700 (rounded) — within 5% tolerance.
        text: 'iPhone 13 ราคาเริ่มต้น 14,700 บาทค่ะ',
        toolCalls: [],
        inputTokens: 120,
        outputTokens: 25,
        modelName: 'claude-sonnet-4-6',
      } satisfies LlmChatResponse);
    const { svc, searchProducts } = await build(chat);
    searchProducts.run.mockResolvedValue({
      products: [{ id: 'p1', name: 'iPhone 13', priceThb: 14691 }],
    });
    const result = await svc.generateReply({
      text: 'iPhone 13 ราคา',
      roomId: 'r1',
      customerId: null,
    });
    expect(result.reply).toContain('14,700');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('passes reply without any price mention even if no tools used', async () => {
    const chat = jest.fn().mockResolvedValue({
      text: 'สวัสดีค่ะ สนใจรุ่นไหนเป็นพิเศษคะ',
      toolCalls: [],
      inputTokens: 80,
      outputTokens: 18,
      modelName: 'claude-sonnet-4-6',
    } satisfies LlmChatResponse);
    const { svc } = await build(chat);
    const result = await svc.generateReply({
      text: 'สวัสดี',
      roomId: 'r1',
      customerId: null,
    });
    expect(result.reply).toContain('สวัสดี');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
