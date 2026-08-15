import { Test } from '@nestjs/testing';
import { SalesBotService } from './sales-bot.service';
import { SearchProductsTool } from './tools/search-products.tool';
import { CalculateInstallmentTool } from './tools/calculate-installment.tool';
import { ListPromotionsTool } from './tools/list-promotions.tool';
import { HandoffToHumanTool } from './tools/handoff-to-human.tool';
import { CaptureLeadTool } from './tools/capture-lead.tool';
import { GetInstallmentRatesTool } from './tools/get-installment-rates.tool';
import { SearchKnowledgeBaseTool } from './tools/search-knowledge-base.tool';
import { LlmProviderRegistry } from './providers/llm-provider.registry';
import { PersonaService } from '../staff-chat/services/persona.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
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
    const getInstallmentRates = { run: jest.fn() };
    const searchKnowledgeBase = { run: jest.fn() };
    const persona = {
      getBase: jest.fn().mockResolvedValue('test-base'),
      getBotExtras: jest.fn().mockResolvedValue('-extras'),
      getBot: jest.fn().mockResolvedValue('test-bot-prompt'),
      invalidateCache: jest.fn(),
      isCustomized: jest.fn().mockResolvedValue({ base: false, extras: false }),
    };
    const aiUsage = { record: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        SalesBotService,
        { provide: LlmProviderRegistry, useValue: registry },
        { provide: SearchProductsTool, useValue: searchProducts },
        { provide: CalculateInstallmentTool, useValue: calcInstallment },
        { provide: ListPromotionsTool, useValue: listPromotions },
        { provide: HandoffToHumanTool, useValue: handoff },
        { provide: CaptureLeadTool, useValue: captureLead },
        { provide: GetInstallmentRatesTool, useValue: getInstallmentRates },
        { provide: SearchKnowledgeBaseTool, useValue: searchKnowledgeBase },
        { provide: PersonaService, useValue: persona },
        { provide: AiUsageService, useValue: aiUsage },
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
      getInstallmentRates,
      searchKnowledgeBase,
      aiUsage,
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

  it('falls back to staff message after MAX_TOOL_HOPS unresolved hops', async () => {
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
    // MAX_TOOL_HOPS (4) hops × 1 tool call each.
    expect(searchProducts.run).toHaveBeenCalledTimes(4);
  });

  it('records usage via AiUsageService with the provider-reported model', async () => {
    const chat = jest.fn().mockResolvedValue({
      text: 'สวัสดีค่ะ สนใจรุ่นไหนคะ',
      toolCalls: [],
      inputTokens: 120,
      outputTokens: 25,
      modelName: 'claude-sonnet-4-6',
    } satisfies LlmChatResponse);
    const { svc, aiUsage } = await build(chat);
    await svc.generateReply({ text: 'สวัสดี', roomId: 'r1', customerId: null });
    expect(aiUsage.record).toHaveBeenCalledWith({
      service: 'sales-bot',
      method: 'generateReply',
      model: 'claude-sonnet-4-6',
      inputTokens: 120,
      outputTokens: 25,
      status: 'success',
    });
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
      {} as any, // GetInstallmentRatesTool — unused by the private estimateConfidence path
      {} as any, // SearchKnowledgeBaseTool — unused by the private estimateConfidence path
      {} as any, // PersonaService — unused by the private estimateConfidence path
      {} as any, // AiUsageService
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
  it('blocks reply with hallucinated price not seen in any tool result (retry also fails → staff)', async () => {
    const hallucinated = {
      // Hallucinated reply: tool only returned 14,691 + 17,000.
      text: 'iPhone 15 ราคาเริ่มต้น 7,000 บาทค่ะ',
      toolCalls: [],
      inputTokens: 120,
      outputTokens: 25,
      modelName: 'gemini-2.5-flash',
    } satisfies LlmChatResponse;
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
      // ครั้งแรกโดนบล็อก → guard ป้อน feedback ให้เขียนใหม่ → ยังมั่วเลขเดิมอีก
      .mockResolvedValueOnce(hallucinated)
      .mockResolvedValueOnce(hallucinated);
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
    // Retry ครั้งเดียวเท่านั้น: search + คำตอบมั่ว + คำตอบมั่วหลัง feedback = 3 calls
    expect(chat).toHaveBeenCalledTimes(3);
    // feedback ที่ป้อนกลับต้องเป็นข้อความ SYSTEM GUARD
    const retryMessages = chat.mock.calls[2][0].messages;
    expect(retryMessages[retryMessages.length - 1].content).toContain('[SYSTEM GUARD');
  });

  it('grounding-blocked reply self-corrects on retry and auto-sends the fixed reply', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { id: 'tu_1', name: 'search_products', input: { query: 'iPhone' } },
        ],
        inputTokens: 100,
        outputTokens: 10,
        modelName: 'claude-haiku-4-5-20251001',
      } satisfies LlmChatResponse)
      .mockResolvedValueOnce({
        // แต่งค่างวดเอง (1,460 ไม่มีในผล tool) → โดนบล็อก
        text: 'iPhone 13 ราคา 14,691 บาท ผ่อนเดือนละ 1,460 บาทค่ะ',
        toolCalls: [],
        inputTokens: 120,
        outputTokens: 25,
        modelName: 'claude-haiku-4-5-20251001',
      } satisfies LlmChatResponse)
      .mockResolvedValueOnce({
        // หลังได้ feedback: ตัดเลขไม่มีแหล่งออก เหลือราคาที่ grounded
        text: 'iPhone 13 ราคา 14,691 บาทค่ะ สนใจผ่อนกี่เดือนดีคะ',
        toolCalls: [],
        inputTokens: 130,
        outputTokens: 20,
        modelName: 'claude-haiku-4-5-20251001',
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
    expect(result.reply).toContain('14,691');
    expect(result.reply).not.toContain('1,460');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(chat).toHaveBeenCalledTimes(3);
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

  it('บอททวนเลขงบที่ลูกค้าพิมพ์เองได้ โดยไม่ต้องเรียก tool (แก้ false positive 2026-08-15)', async () => {
    const chat = jest.fn().mockResolvedValue({
      text: 'ได้ค่ะ งบดาวน์ 3,000 บาท\n\nพี่อยากผ่อนต่อเดือนสบาย ๆ ไม่เกินประมาณเท่าไหร่คะ',
      toolCalls: [],
      inputTokens: 50,
      outputTokens: 15,
      modelName: 'claude-sonnet-5',
    } satisfies LlmChatResponse);
    const { svc } = await build(chat);
    const result = await svc.generateReply({
      text: '3000',
      roomId: 'r1',
      customerId: null,
    });
    expect(result.reply).toContain('3,000');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('บอททวนเลขที่ตัวเองเคยส่งไปแล้ว (จาก priorMessages) ได้โดยไม่เรียก tool ซ้ำ', async () => {
    const chat = jest.fn().mockResolvedValue({
      text: 'ได้เลยค่า เรทที่ 1 ดาวน์ 1,900 บาทนะคะ รบกวนส่งสเตทเม้นท์ย้อนหลัง 3 เดือนมาในแชทนี้ได้เลยค่ะ',
      toolCalls: [],
      inputTokens: 50,
      outputTokens: 20,
      modelName: 'claude-sonnet-5',
    } satisfies LlmChatResponse);
    const { svc } = await build(chat);
    const result = await svc.generateReply({
      text: 'เรทที่ 1',
      roomId: 'r1',
      customerId: null,
      priorMessages: [
        { role: 'assistant', content: 'เรทที่ 1 ดาวน์ 1,900 บาท ผ่อนเดือนละ 2,566 บาท 12 งวด สนใจเรทไหนดีคะ' },
      ],
    });
    expect(result.reply).toContain('1,900');
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

  // Issue #1337 — v2 rework of #1332. Owner live-test verdict: percent-only
  // replies read as robotic and must never say ดอกเบี้ย/%; quotes must be
  // BAHT (down + monthly + term) sourced from PricingTemplate, exactly like
  // the shop's price stickers. get_installment_rates now returns real baht
  // under the `downPayment` / `monthlyPrice` keys, which collectGroundedPrices
  // was extended to collect (#1337) — so those exact template figures are
  // groundable, while any OTHER baht figure the model invents is still
  // HALLUCINATION_BLOCKED. These two specs pin that contract both ways.
  describe('get_installment_rates grounding (#1337 — baht from PricingTemplate)', () => {
    // Sticker-exact shape (#1337 follow-up): each rate carries its OWN
    // monthlyPrice — rate1 = installmentBestchoicePrice, rate2 =
    // installmentFinancePrice (stickers.service.ts:175/:185). BOTH monthlies
    // must be groundable so the bot can quote the sticker's two lines.
    const toolResult = {
      templates: [
        {
          brand: 'Apple',
          model: 'iPhone 17 Pro Max',
          storage: '256GB',
          hasWarranty: false,
          rate1: { downPayment: 4900, monthlyPrice: 2490, termMonths: 24 },
          rate2: { downPayment: 1900, monthlyPrice: 2690, termMonths: 12 },
        },
      ],
    };

    it('reply quoting the EXACT template baht figures (both downs AND both monthlies) passes the guard, auto-sends, confidence 0.95', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { id: 'tu_1', name: 'get_installment_rates', input: { query: 'iPhone 17 Pro Max' } },
          ],
          inputTokens: 100,
          outputTokens: 10,
          modelName: 'claude-sonnet-4-6',
        } satisfies LlmChatResponse)
        .mockResolvedValueOnce({
          text:
            'iPhone 17 Pro Max ดาวน์ 4,900 บาท ผ่อนเดือนละ 2,490 บาท 24 งวดค่ะ ' +
            'หรือดาวน์เบา ๆ 1,900 บาท ผ่อนเดือนละ 2,690 บาท 12 งวดก็ได้นะคะ 😊',
          toolCalls: [],
          inputTokens: 140,
          outputTokens: 60,
          modelName: 'claude-sonnet-4-6',
        } satisfies LlmChatResponse);
      const { svc, getInstallmentRates } = await build(chat);
      getInstallmentRates.run.mockResolvedValue(toolResult);

      const result = await svc.generateReply({
        text: 'iPhone 17 Pro Max ผ่อนเดือนละเท่าไหร่คะ',
        roomId: 'r1',
        customerId: null,
      });

      expect(getInstallmentRates.run).toHaveBeenCalled();
      expect(result.toolsUsed).toEqual(['get_installment_rates']);
      expect(result.reply).toContain('4,900');
      expect(result.reply).toContain('2,490');
      expect(result.reply).toContain('1,900');
      expect(result.reply).toContain('2,690');
      expect(result.reply).not.toContain('staff');
      expect(result.confidence).toBe(0.95);
    });

    it('reply inventing a baht figure NOT in the template result gets HALLUCINATION_BLOCKED even though the grounded set is non-empty', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { id: 'tu_1', name: 'get_installment_rates', input: { query: 'iPhone 17 Pro Max' } },
          ],
          inputTokens: 100,
          outputTokens: 10,
          modelName: 'claude-sonnet-4-6',
        } satisfies LlmChatResponse)
        .mockResolvedValue({
          // 10,000 / 867 do not match downPayment=4900/1900 or monthlyPrice=2490
          // within ±5% — must still be blocked despite grounded.size > 0.
          // (persistent mock: the guard's one self-correct retry gets the same
          // invented figures and must fall back to staff)
          text: 'ดาวน์ 10,000 บาท ผ่อนเดือนละ 867 บาทค่ะ',
          toolCalls: [],
          inputTokens: 120,
          outputTokens: 20,
          modelName: 'claude-sonnet-4-6',
        } satisfies LlmChatResponse);
      const { svc, getInstallmentRates } = await build(chat);
      getInstallmentRates.run.mockResolvedValue(toolResult);

      const result = await svc.generateReply({
        text: 'iPhone 17 Pro Max ผ่อนเดือนละเท่าไหร่คะ',
        roomId: 'r1',
        customerId: null,
      });

      expect(result.reply).not.toContain('10,000');
      expect(result.reply).not.toContain('867');
      expect(result.reply).toContain('staff');
      expect(result.confidence).toBeLessThanOrEqual(0.3);
    });

    it('no PricingTemplate match (templates: []) carries no grounded baht — any invented figure is blocked', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ id: 'tu_1', name: 'get_installment_rates', input: { query: 'Nokia 3310' } }],
          inputTokens: 100,
          outputTokens: 10,
          modelName: 'claude-sonnet-4-6',
        } satisfies LlmChatResponse)
        .mockResolvedValue({
          // persistent: retry หลัง guard feedback ยังมั่วเหมือนเดิม → staff fallback
          text: 'Nokia 3310 ดาวน์ 500 บาท ผ่อนเดือนละ 1,200 บาทค่ะ',
          toolCalls: [],
          inputTokens: 120,
          outputTokens: 20,
          modelName: 'claude-sonnet-4-6',
        } satisfies LlmChatResponse);
      const { svc, getInstallmentRates } = await build(chat);
      getInstallmentRates.run.mockResolvedValue({ templates: [] });

      const result = await svc.generateReply({
        text: 'Nokia 3310 มีไหมคะ',
        roomId: 'r1',
        customerId: null,
      });

      expect(result.reply).not.toContain('1,200');
      expect(result.reply).toContain('staff');
      expect(result.confidence).toBeLessThanOrEqual(0.3);
    });
  });

  // Reviewer fix (#1337): calculate_installment's baht outputs (downAmountThb /
  // monthlyThb / totalPaidThb) must be grounded too. Previously only priceThb
  // was collected from the calc result, so a reply quoting the calculated
  // monthly/down figures got HALLUCINATION_BLOCKED — steering the persona's
  // "ดอกเบี้ยกี่%" objection answer into guard-blocked silence.
  describe('calculate_installment grounding (#1337 reviewer fix)', () => {
    it('reply quoting downAmountThb + monthlyThb + totalPaidThb from a calculate result passes the guard', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [
            {
              id: 'tu_1',
              name: 'calculate_installment',
              input: { productId: 'p1', downPct: 20, tenureMonths: 12 },
            },
          ],
          inputTokens: 100,
          outputTokens: 10,
          modelName: 'claude-sonnet-4-6',
        } satisfies LlmChatResponse)
        .mockResolvedValueOnce({
          text: 'iPhone 15 128GB ดาวน์ 4,980 บาท ผ่อนเดือนละ 1,909 บาท 12 งวด รวมทั้งสัญญา 27,888 บาทค่ะ',
          toolCalls: [],
          inputTokens: 140,
          outputTokens: 60,
          modelName: 'claude-sonnet-4-6',
        } satisfies LlmChatResponse);
      const { svc, calcInstallment } = await build(chat);
      calcInstallment.run.mockResolvedValue({
        productName: 'iPhone 15 128GB',
        priceThb: 24900,
        downAmountThb: 4980,
        financedThb: 19920,
        tenureMonths: 12,
        ratePct: 15,
        monthlyThb: 1909,
        totalPaidThb: 27888,
      });

      const result = await svc.generateReply({
        text: 'iPhone 15 ผ่อนเดือนละเท่าไหร่คะ',
        roomId: 'r1',
        customerId: null,
      });

      expect(result.reply).toContain('4,980');
      expect(result.reply).toContain('1,909');
      expect(result.reply).toContain('27,888');
      expect(result.reply).not.toContain('staff');
      expect(result.confidence).toBe(0.95);
    });
  });

  it('records error usage row with accumulated tokens when provider throws mid-loop', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { id: 'tu_1', name: 'search_products', input: { query: 'iPhone' } },
        ],
        inputTokens: 100,
        outputTokens: 20,
        modelName: 'claude-sonnet-4-6',
      } satisfies LlmChatResponse)
      .mockRejectedValueOnce(new Error('provider_error: rate limit exceeded'));
    const { svc, searchProducts, aiUsage } = await build(chat);
    searchProducts.run.mockResolvedValue({
      products: [{ id: 'p1', name: 'iPhone 13', priceThb: 14691 }],
    });
    await expect(
      svc.generateReply({
        text: 'iPhone กี่บาท',
        roomId: 'r1',
        customerId: null,
      })
    ).rejects.toThrow('provider_error');
    expect(aiUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'sales-bot',
        status: 'error',
        errorKind: 'provider_error',
        inputTokens: 100,
        outputTokens: 20,
      })
    );
  });

  it('records error usage row with errorKind tool_error when a tool run rejects (not provider_error)', async () => {
    const chat = jest.fn().mockResolvedValueOnce({
      text: '',
      toolCalls: [
        { id: 'tu_1', name: 'search_products', input: { query: 'iPhone' } },
      ],
      inputTokens: 100,
      outputTokens: 20,
      modelName: 'claude-sonnet-4-6',
    } satisfies LlmChatResponse);
    const { svc, searchProducts, aiUsage } = await build(chat);
    searchProducts.run.mockRejectedValue(new Error('prisma: connection terminated'));
    await expect(
      svc.generateReply({
        text: 'iPhone กี่บาท',
        roomId: 'r1',
        customerId: null,
      })
    ).rejects.toThrow('prisma: connection terminated');
    expect(aiUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'sales-bot',
        status: 'error',
        errorKind: 'tool_error',
        inputTokens: 100,
        outputTokens: 20,
      })
    );
  });

  describe('SalesBotResult.attachments (B3 §5)', () => {
    const searchResultOneUnit = {
      query: { brand: 'Apple', model: 'iPhone 15', storage: null, color: null },
      totalMatches: 1,
      priceMissingCount: 0,
      groups: [
        {
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          condition: 'NEW',
          unitCount: 1,
          minPrice: 28900,
          maxPrice: 28900,
          units: [
            {
              id: 'prd-1',
              priceThb: 28900,
              photoAvailable: true,
              photoUrl: 'https://cdn.example.com/p1.jpg',
              webUrl: 'https://shop.example.com/products/prd-1',
              reserved: false,
            },
          ],
        },
      ],
    };

    const twoHopChat = (toolName: string, finalText: string) =>
      jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ id: 't1', name: toolName, input: { query: 'iPhone 15' } }],
          inputTokens: 10,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        })
        // persistent (ไม่ใช่ Once): เคสที่ finalText โดน grounding block จะมี
        // retry อีก 1 call หลัง guard feedback — ให้ได้คำตอบเดิมซ้ำ → staff fallback
        .mockResolvedValue({
          text: finalText,
          toolCalls: [],
          inputTokens: 10,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        });

    it('แนบรูป+ลิงก์เมื่อ search_products ให้ผลเจาะจงเครื่องเดียว', async () => {
      const chat = twoHopChat('search_products', 'iPhone 15 128GB ราคา 28,900 บาทค่ะ');
      const { svc, searchProducts } = await build(chat);
      searchProducts.run.mockResolvedValue(searchResultOneUnit);

      const r = await svc.generateReply({ text: 'iPhone 15 มีไหม', roomId: 'r1', customerId: null });
      expect(r.attachments).toEqual([
        {
          productId: 'prd-1',
          imageUrl: 'https://cdn.example.com/p1.jpg',
          webUrl: 'https://shop.example.com/products/prd-1',
        },
      ]);
    });

    it('ผลกว้าง (เกิน 2 เครื่อง) → ไม่แนบอะไรเลย', async () => {
      const many = {
        ...searchResultOneUnit,
        totalMatches: 3,
        groups: [
          {
            ...searchResultOneUnit.groups[0],
            unitCount: 3,
            units: [
              { id: 'a', priceThb: 1, photoUrl: 'https://c/a.jpg', webUrl: 'https://s/a', reserved: false },
              { id: 'b', priceThb: 2, photoUrl: 'https://c/b.jpg', webUrl: 'https://s/b', reserved: false },
              { id: 'c', priceThb: 3, photoUrl: 'https://c/c.jpg', webUrl: 'https://s/c', reserved: false },
            ],
          },
        ],
      };
      const chat = twoHopChat('search_products', 'มีหลายเครื่องเลยค่ะ');
      const { svc, searchProducts } = await build(chat);
      searchProducts.run.mockResolvedValue(many);

      const r = await svc.generateReply({ text: 'มีอะไรบ้าง', roomId: 'r1', customerId: null });
      expect(r.attachments).toBeUndefined();
    });

    it('เครื่องไม่มีรูปแต่มีลิงก์ → ยังแนบ (imageUrl หายไปเฉย ๆ)', async () => {
      const noPhoto = {
        ...searchResultOneUnit,
        groups: [
          {
            ...searchResultOneUnit.groups[0],
            units: [
              {
                id: 'prd-9',
                priceThb: 28900,
                photoAvailable: false,
                photoUrl: null,
                webUrl: 'https://shop.example.com/products/prd-9',
                reserved: false,
              },
            ],
          },
        ],
      };
      const chat = twoHopChat('search_products', 'มีค่ะ ราคา 28,900 บาท');
      const { svc, searchProducts } = await build(chat);
      searchProducts.run.mockResolvedValue(noPhoto);

      const r = await svc.generateReply({ text: 'iPhone 15', roomId: 'r1', customerId: null });
      expect(r.attachments).toEqual([
        { productId: 'prd-9', webUrl: 'https://shop.example.com/products/prd-9' },
      ]);
    });

    it('calculate_installment แนบเครื่องที่คำนวณให้', async () => {
      const chat = twoHopChat('calculate_installment', 'ผ่อนเดือนละ 3,113 บาทค่ะ');
      const { svc, calcInstallment } = await build(chat);
      calcInstallment.run.mockResolvedValue({
        productId: 'prd-5',
        productName: 'iPhone 15',
        monthlyThb: 3113,
        photoUrl: 'https://cdn.example.com/p5.jpg',
        webUrl: 'https://shop.example.com/products/prd-5',
      });

      const r = await svc.generateReply({ text: 'ผ่อน 12 งวด', roomId: 'r1', customerId: null });
      expect(r.attachments?.[0].productId).toBe('prd-5');
    });

    it('คำตอบที่โดน grounding block → ไม่แนบอะไรเลย', async () => {
      const chat = twoHopChat('search_products', 'ราคาเริ่มต้น 7,000 บาทค่ะ'); // ไม่ตรง grounded
      const { svc, searchProducts } = await build(chat);
      searchProducts.run.mockResolvedValue(searchResultOneUnit);

      const r = await svc.generateReply({ text: 'iPhone 15', roomId: 'r1', customerId: null });
      expect(r.confidence).toBe(0.3);
      expect(r.attachments).toBeUndefined();
    });

    // review round 1 [I2]: ก่อนหน้านี้ไม่มีเทสต์ตรวจ max-hop-exhausted path เลย —
    // เคสเดิม "falls back to staff message after 3 unresolved hops" (บรรทัด 163)
    // mock tool result ว่าง (`{ products: [] }`) จึงจับ mutation "แนบ attachments
    // บนทางออก max-hop" ไม่ได้ (ไม่มีรูปให้แนบอยู่แล้วไม่ว่า mutation จะใส่โค้ดแนบหรือไม่).
    // เคสนี้ใช้ tool result ที่มีรูป+ลิงก์จริง (searchResultOneUnit) เพื่อพิสูจน์ว่า
    // ทางออก max-hop (:232-240) ไม่คืน attachments แม้ระหว่างทางจะเก็บเข้า Map ไว้แล้วก็ตาม
    it('hop จนครบ (max-hop exhausted) แม้ tool result มีรูปจริง → ไม่มี attachments', async () => {
      const alwaysToolCall = jest.fn().mockResolvedValue({
        text: '',
        toolCalls: [{ id: 't1', name: 'search_products', input: { query: 'iPhone 15' } }],
        inputTokens: 10,
        outputTokens: 5,
        modelName: 'claude-sonnet-4-6',
      } satisfies LlmChatResponse);
      const { svc, searchProducts } = await build(alwaysToolCall);
      searchProducts.run.mockResolvedValue(searchResultOneUnit);

      const r = await svc.generateReply({ text: 'iPhone 15 มีไหม', roomId: 'r1', customerId: null });
      expect(r.reply).toContain('staff');
      expect(r.confidence).toBe(0.3);
      expect(r.attachments).toBeUndefined();
    });
  });

  describe('grounding จากข้อความที่แอดมินเขียนเอง (B3 Task 6)', () => {
    it('บอทพูดตัวเลขส่วนลดที่อยู่ในคำอธิบายโปรได้ ไม่โดน block', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ id: 't1', name: 'list_promotions', input: {} }],
          inputTokens: 5,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        })
        .mockResolvedValueOnce({
          text: 'เดือนนี้ลดทันที 1,000 บาทค่ะ',
          toolCalls: [],
          inputTokens: 5,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        });
      const { svc, listPromotions } = await build(chat);
      listPromotions.run.mockResolvedValue({
        promotions: [
          {
            id: 'p1',
            name: 'ลดพิเศษ',
            description: 'ลดทันที 1,000 บาท',
            endsAt: '2026-12-31T00:00:00.000Z',
            appliesTo: 'ALL',
            minPurchaseThb: null,
          },
        ],
      });

      const r = await svc.generateReply({ text: 'มีโปรไหม', roomId: 'r1', customerId: null });
      expect(r.confidence).not.toBe(0.3);
      expect(r.reply).toContain('1,000');
    });

    // review round 1 [C2] — bracket the exact-1,000 case above with the threshold's
    // two neighbors so the boundary is proven at the e2e level, not just in the util:
    // 999 (< MIN_GROUNDED_THB) must pass WITHOUT needing a grounded set at all (this
    // is the exact bug: list_promotions is the only tool called, its description text
    // never crosses 1,000 so the grounded set stays empty — the old early-return
    // blocked this unconditionally); 1,001 (>= MIN_GROUNDED_THB) must still require
    // and receive real grounding from the promo description (backstop not loosened).
    it('บอทพูด "999 บาท" (ต่ำกว่า threshold) ได้แม้ grounded set จะว่างเปล่า', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ id: 't1', name: 'list_promotions', input: {} }],
          inputTokens: 5,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        })
        .mockResolvedValueOnce({
          text: 'เดือนนี้ลด 999 บาทค่ะ',
          toolCalls: [],
          inputTokens: 5,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        });
      const { svc, listPromotions } = await build(chat);
      listPromotions.run.mockResolvedValue({
        promotions: [
          {
            id: 'p1',
            name: 'ลดพิเศษ',
            description: 'ลด 999 บาท', // < 1,000 → ไม่เข้า grounded set เลย (ยืนยันว่าไม่จำเป็นต้องเข้า)
            endsAt: '2026-12-31T00:00:00.000Z',
            appliesTo: 'ALL',
            minPurchaseThb: null,
          },
        ],
      });

      const r = await svc.generateReply({ text: 'มีโปรไหม', roomId: 'r1', customerId: null });
      expect(r.confidence).not.toBe(0.3);
      expect(r.reply).toContain('999');
    });

    it('บอทพูด "1,001 บาท" (สูงกว่า threshold) ได้เมื่อมีอยู่ใน description จริง', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ id: 't1', name: 'list_promotions', input: {} }],
          inputTokens: 5,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        })
        .mockResolvedValueOnce({
          text: 'เดือนนี้ลดทันที 1,001 บาทค่ะ',
          toolCalls: [],
          inputTokens: 5,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        });
      const { svc, listPromotions } = await build(chat);
      listPromotions.run.mockResolvedValue({
        promotions: [
          {
            id: 'p1',
            name: 'ลดพิเศษ',
            description: 'ลดทันที 1,001 บาท', // >= 1,000 → ต้องเข้า grounded set จริงถึงจะผ่าน
            endsAt: '2026-12-31T00:00:00.000Z',
            appliesTo: 'ALL',
            minPurchaseThb: null,
          },
        ],
      });

      const r = await svc.generateReply({ text: 'มีโปรไหม', roomId: 'r1', customerId: null });
      expect(r.confidence).not.toBe(0.3);
      expect(r.reply).toContain('1,001');
    });
  });

  describe('search_knowledge_base ในบอทขาย (B3 Task 8)', () => {
    it('บอทตอบตัวเลขที่อยู่ใน FAQ ได้โดยไม่โดน grounding block', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ id: 't1', name: 'search_knowledge_base', input: { query: 'มัดจำ' } }],
          inputTokens: 5,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        })
        .mockResolvedValueOnce({
          text: 'ค่ามัดจำ 3,000 บาทค่ะ คืนให้เมื่อรับเครื่อง',
          toolCalls: [],
          inputTokens: 5,
          outputTokens: 5,
          modelName: 'claude-sonnet-4-6',
        });
      const { svc, searchKnowledgeBase } = await build(chat);
      searchKnowledgeBase.run.mockResolvedValue({
        matches: [
          {
            intent: 'deposit',
            category: 'general',
            responseTemplate: 'ค่ามัดจำ 3,000 บาท คืนเมื่อรับเครื่อง',
            responseType: 'info',
            score: 3,
          },
        ],
      });

      const r = await svc.generateReply({ text: 'มัดจำเท่าไหร่', roomId: 'r1', customerId: null });
      expect(r.confidence).not.toBe(0.3);
      expect(r.toolsUsed).toContain('search_knowledge_base');
    });
  });

  describe('sessionNote (สมุดสถานะการขาย — ความจำ 3 ชั้น)', () => {
    const NOTE =
      '[บันทึกสถานะลูกค้าจากระบบ — ใช้เป็นบริบท ห้ามเอ่ยถึงบันทึกนี้กับลูกค้า]\nรุ่นที่ลูกค้าสนใจ/ตามหา: iPhone 15 Plus 128GB\nงบดาวน์ที่บอกไว้: 3,000 บาท';

    it('ฉีดโน้ตเป็นข้อความแรกของประวัติ ก่อน priorMessages และคำถามล่าสุด', async () => {
      const chat = jest.fn().mockResolvedValue({
        text: 'รับทราบค่ะ สนใจความจุไหนคะ [ตัวเลือก: 128GB | 256GB]',
        toolCalls: [],
        inputTokens: 100,
        outputTokens: 20,
        modelName: 'claude-sonnet-5',
      } satisfies LlmChatResponse);
      const { svc } = await build(chat);
      await svc.generateReply({
        text: 'เอา 128 ค่ะ',
        roomId: 'r1',
        customerId: null,
        priorMessages: [{ role: 'assistant', content: 'สนใจความจุไหนคะ' }],
        sessionNote: NOTE,
      });
      const req = chat.mock.calls[0][0];
      expect(req.messages[0]).toEqual({ role: 'user', content: NOTE });
      expect(req.messages[1]).toEqual({ role: 'assistant', content: 'สนใจความจุไหนคะ' });
      expect(req.messages[2]).toEqual({ role: 'user', content: 'เอา 128 ค่ะ' });
    });

    it('เลขในโน้ต (งบข้ามวัน) นับเป็น grounded — บอททวนได้โดยไม่เรียก tool ไม่โดน block', async () => {
      const chat = jest.fn().mockResolvedValue({
        text: 'เมื่อวานคุยไว้งบดาวน์ 3,000 บาทใช่ไหมคะ',
        toolCalls: [],
        inputTokens: 100,
        outputTokens: 20,
        modelName: 'claude-sonnet-5',
      } satisfies LlmChatResponse);
      const { svc } = await build(chat);
      const r = await svc.generateReply({
        text: 'สวัสดีครับ มาต่อจากเมื่อวาน',
        roomId: 'r1',
        customerId: null,
        sessionNote: NOTE,
      });
      expect(r.reply).toContain('3,000');
      expect(r.confidence).not.toBe(0.3);
      expect(chat).toHaveBeenCalledTimes(1); // ไม่มี retry จาก grounding block
    });

    it('ไม่มีโน้ต → โครง messages เดิมทุกประการ (back-compat)', async () => {
      const chat = jest.fn().mockResolvedValue({
        text: 'สวัสดีค่ะ สนใจรุ่นไหนคะ',
        toolCalls: [],
        inputTokens: 100,
        outputTokens: 20,
        modelName: 'claude-sonnet-5',
      } satisfies LlmChatResponse);
      const { svc } = await build(chat);
      await svc.generateReply({ text: 'สวัสดีครับ', roomId: 'r1', customerId: null });
      const req = chat.mock.calls[0][0];
      expect(req.messages).toEqual([{ role: 'user', content: 'สวัสดีครับ' }]);
    });
  });
});
