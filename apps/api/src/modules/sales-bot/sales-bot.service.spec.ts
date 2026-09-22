import { Test } from '@nestjs/testing';
import {
  SalesBotService,
  redactMediaUrls,
  shopClockLine,
  NO_STOCK_TOOL_RESULT,
  STAFF_FALLBACK_REPLY,
  groundingGuardNote,
  isBarePromise,
  isCleanSideEffectResult,
  rateCardMissingNote,
  reconcileRateCardResult,
  staffFallbackReply,
  stripUnsentImageClaims,
  withSystemNote,
} from './sales-bot.service';
import { SearchProductsTool } from './tools/search-products.tool';
import { CalculateInstallmentTool } from './tools/calculate-installment.tool';
import { ListPromotionsTool } from './tools/list-promotions.tool';
import { HandoffToHumanTool } from './tools/handoff-to-human.tool';
import { CaptureLeadTool } from './tools/capture-lead.tool';
import { GetInstallmentRatesTool } from './tools/get-installment-rates.tool';
import { SearchKnowledgeBaseTool } from './tools/search-knowledge-base.tool';
import { RecommendDevicesTool } from './tools/recommend-devices.tool';
import { CompareDevicesTool } from './tools/compare-devices.tool';
import { NO_CARD_REQUESTED, SendRateCardTool } from './tools/send-rate-card.tool';
import { NotifyStaffTool } from './tools/notify-staff.tool';
import { BotRuntimeConfigService, NO_STOCK_PROMPT, type RateCardsConfig } from './bot-runtime-config.service';
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
    const recommendDevices = { run: jest.fn() };
    const compareDevices = { run: jest.fn() };
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
        { provide: RecommendDevicesTool, useValue: recommendDevices },
        { provide: CompareDevicesTool, useValue: compareDevices },
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
      recommendDevices,
      compareDevices,
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
    // MAX_TOOL_HOPS (6) hops × 1 tool call each (โมเดลจำลองไม่ฟัง toolChoice จึงเรียกต่อถึงรอบสุดท้าย)
    expect(searchProducts.run).toHaveBeenCalledTimes(6);
  });

  it('รอบสุดท้ายของลูปบังคับ toolChoice none (ให้เขียนคำตอบ) · รอบก่อนหน้าไม่ส่ง', async () => {
    const chat = jest.fn().mockResolvedValue({
      text: '',
      toolCalls: [{ id: 'tu_loop', name: 'search_products', input: { query: 'x' } }],
      inputTokens: 1,
      outputTokens: 1,
      modelName: 'm',
    } satisfies LlmChatResponse);
    const { svc, searchProducts } = await build(chat);
    searchProducts.run.mockResolvedValue({ products: [] });
    await svc.generateReply({ text: '???', roomId: 'r1', customerId: null });
    const choices = chat.mock.calls.map((c) => c[0].toolChoice);
    expect(choices).toEqual([undefined, undefined, undefined, undefined, undefined, 'none']);
  });

  it('คำตอบว่าง (ไม่มีข้อความ ไม่มีเครื่องมือ) → ข้อความสำรองให้พนักงานเช็ค ไม่ส่งบับเบิลว่าง', async () => {
    const chat = jest.fn().mockResolvedValue({
      text: '  ',
      toolCalls: [],
      inputTokens: 1,
      outputTokens: 1,
      modelName: 'm',
    } satisfies LlmChatResponse);
    const { svc } = await build(chat);
    const result = await svc.generateReply({ text: 'สวัสดี', roomId: 'r1', customerId: null });
    expect(result.reply).toContain('staff');
    expect(result.confidence).toBeLessThanOrEqual(0.3);
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
      {} as any, // RecommendDevicesTool — unused
      {} as any, // CompareDevicesTool — unused
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

    // synth C02 (2026-09-22): เลิกกฎ "สั้นกว่า 20 ตัวอักษร = 0.6" — คำตอบสั้นที่ถูกต้องเคยถูกเปลี่ยน
    // เป็นข้อความรอแอดมิน · เหลือ 0.6 เฉพาะ "รับปากเปล่า ๆ" ที่ไม่ได้เรียกเครื่องมือในเทิร์นนั้น
    it('คำตอบสั้นที่ไม่ใช่การรับปาก (ไม่มี tool) → ≥ 0.8 ส่งได้', () => {
      expect((svc as any).estimateConfidence('ยินดีค่ะ 😊', [])).toBeGreaterThanOrEqual(0.8);
      expect((svc as any).estimateConfidence('ค่ะ', [])).toBeGreaterThanOrEqual(0.8);
      expect((svc as any).estimateConfidence('ได้ค่ะ ขอบคุณค่ะ', [])).toBeGreaterThanOrEqual(0.8);
    });

    it('รับปากเปล่า ๆ สั้น ๆ ไม่ได้เรียก tool → 0.6 (กันรับปากนโยบาย/อนุมัติ/สต๊อกเอง)', () => {
      for (const t of ['ได้ค่ะ', 'ผ่านค่ะ', 'มีค่ะ', 'ส่งได้ค่ะ', 'ได้เลยค่ะ 😊', 'ผ่านแน่นอนค่ะ!', 'ได้ค่ะพี่']) {
        expect((svc as any).estimateConfidence(t, [])).toBe(0.6);
      }
    });

    it('รับปากสั้น ๆ แต่เทิร์นนั้นเรียก tool แล้ว → 0.95', () => {
      expect((svc as any).estimateConfidence('มีค่ะ', ['get_installment_rates'])).toBe(0.95);
    });

    it('คำตอบว่าง → 0', () => {
      expect((svc as any).estimateConfidence('', [])).toBe(0);
      expect((svc as any).estimateConfidence('   \n', ['search_products'])).toBe(0);
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
      // ข้อความล่าสุดมีบรรทัดเวลาร้านนำหน้า (2026-09-22)
      expect(req.messages[2]).toEqual({ role: 'user', content: expect.stringMatching(/^\[เวลาร้านตอนนี้: .*\]\nเอา 128 ค่ะ$/) });
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
      expect(req.messages).toEqual([
        { role: 'user', content: expect.stringMatching(/^\[เวลาร้านตอนนี้: .*\]\nสวัสดีครับ$/) },
      ]);
    });
  });
});

describe('redactMediaUrls', () => {
  it('ตัด photoUrl/webUrl ทุกระดับความลึก แต่ไม่แตะฟิลด์อื่น', () => {
    const result = {
      units: [
        { model: 'iPhone 15', priceThb: 17500, photoUrl: 'https://x/p.jpg', webUrl: 'https://x/w' },
        { model: 'iPhone 14', priceThb: 13900, photoUrl: null },
      ],
      note: 'ok',
    };
    const redacted = redactMediaUrls(result) as any;
    expect(redacted.units[0]).toEqual({ model: 'iPhone 15', priceThb: 17500 });
    expect(redacted.units[1]).toEqual({ model: 'iPhone 14', priceThb: 13900 });
    expect(redacted.note).toBe('ok');
    // ต้นฉบับต้องไม่ถูกแก้ — collectAttachmentsFromToolResult ใช้ result ดิบ
    expect(result.units[0].photoUrl).toBe('https://x/p.jpg');
    expect(result.units[0].webUrl).toBe('https://x/w');
  });

  it('ค่า primitive/array ผ่านตรง ๆ', () => {
    expect(redactMediaUrls('x')).toBe('x');
    expect(redactMediaUrls([1, 2])).toEqual([1, 2]);
    expect(redactMediaUrls(null)).toBeNull();
  });
});

describe('SalesBotService — โหมดไม่มีสต๊อก / ส่งรูปตารางผ่อน / notify_staff (2026-09-22)', () => {
  // ค่าตั้งรูปที่ขึ้น prod รอบแรก — มีแค่ตารางเครื่องนอก + แผนที่
  const PROD_CARDS: RateCardsConfig = {
    imported_free_down: { storageKey: 'bot-media/rate-cards/imported.jpg', label: 'ตารางผ่อนฟรีดาวน์' },
    shop_map: { storageKey: 'bot-media/rate-cards/map.jpg', label: 'วิธีเดินทางมาร้าน' },
  };

  async function buildWith(
    chat: jest.Mock,
    stockMode: 'LIVE' | 'NO_STOCK',
    rateCards: RateCardsConfig | undefined = PROD_CARDS,
  ) {
    const provider: ILlmProvider = {
      providerName: 'claude',
      chat: chat as unknown as (...args: any[]) => Promise<LlmChatResponse>,
    };
    const persona = {
      getBase: jest.fn(), getBotExtras: jest.fn(), invalidateCache: jest.fn(), isCustomized: jest.fn(),
      getBot: jest.fn().mockResolvedValue('PERSONA'),
    };
    const runtime = {
      getStockMode: jest.fn().mockResolvedValue(stockMode),
      getRateCards: jest.fn().mockResolvedValue(rateCards),
    };
    const sendRateCard = {
      run: jest.fn().mockResolvedValue({
        sent: [{ card: 'imported_free_down', label: 'ตารางผ่อนฟรีดาวน์' }],
        missing: [],
        images: [{ id: 'card:imported_free_down', photoUrl: 'https://s.example.com/i.jpg', productName: 'ตารางผ่อนฟรีดาวน์' }],
      }),
    };
    const notifyStaff = { run: jest.fn().mockResolvedValue({ staffNotified: true }) };
    const noop = () => ({ run: jest.fn() });
    const tools = {
      searchProducts: noop(),
      calcInstallment: noop(),
      recommendDevices: noop(),
      getInstallmentRates: noop(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SalesBotService,
        { provide: LlmProviderRegistry, useValue: { getActive: jest.fn().mockResolvedValue(provider) } },
        { provide: SearchProductsTool, useValue: tools.searchProducts },
        { provide: CalculateInstallmentTool, useValue: tools.calcInstallment },
        { provide: ListPromotionsTool, useValue: noop() },
        { provide: HandoffToHumanTool, useValue: noop() },
        { provide: CaptureLeadTool, useValue: noop() },
        { provide: GetInstallmentRatesTool, useValue: tools.getInstallmentRates },
        { provide: SearchKnowledgeBaseTool, useValue: noop() },
        { provide: RecommendDevicesTool, useValue: tools.recommendDevices },
        { provide: CompareDevicesTool, useValue: noop() },
        { provide: PersonaService, useValue: persona },
        { provide: AiUsageService, useValue: { record: jest.fn() } },
        { provide: BotRuntimeConfigService, useValue: runtime },
        { provide: SendRateCardTool, useValue: sendRateCard },
        { provide: NotifyStaffTool, useValue: notifyStaff },
      ],
    }).compile();
    return { svc: mod.get(SalesBotService), sendRateCard, notifyStaff, runtime, ...tools };
  }

  const final = (text: string) => ({ text, toolCalls: [], inputTokens: 1, outputTokens: 1, modelName: 'm' });
  const call = (name: string, input: Record<string, unknown>, id = 't1') => ({
    text: '', toolCalls: [{ id, name, input }], inputTokens: 1, outputTokens: 1, modelName: 'm',
  });
  const callWithText = (text: string, name: string, input: Record<string, unknown>) => ({
    ...call(name, input),
    text,
  });
  const toolMessages = (req: { messages: { role: string; content: string }[] }) =>
    req.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));

  it('NO_STOCK: ยังประกาศเครื่องมือสต๊อก (คืน unavailable) + ต่อท้ายคำสั่งโหมดไม่มีสต๊อก', async () => {
    const chat = jest.fn().mockResolvedValue(final('สนใจรุ่นไหนคะ'));
    const { svc } = await buildWith(chat, 'NO_STOCK');
    await svc.generateReply({ text: 'สวัสดี', roomId: 'r1', customerId: null });
    const req = chat.mock.calls[0][0];
    const names = req.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['search_products', 'calculate_installment', 'get_installment_rates', 'send_rate_card', 'notify_staff']),
    );
    expect(req.systemPrompt).toBe(`PERSONA\n${NO_STOCK_PROMPT}`);
  });

  it('NO_STOCK: โมเดลเรียก search_products → ไม่ค้น DB จริง คืน unavailable ให้โมเดลอ่าน', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(call('search_products', { query: 'iPhone 15' }))
      .mockResolvedValue(final('สนใจความจุไหนคะ'));
    const { svc, searchProducts } = await buildWith(chat, 'NO_STOCK');
    const r = await svc.generateReply({ text: 'iPhone 15 มีไหม', roomId: 'r1', customerId: null });
    expect(searchProducts.run).not.toHaveBeenCalled();
    expect(toolMessages(chat.mock.calls[1][0])[0]).toEqual(NO_STOCK_TOOL_RESULT);
    expect(r.reply).toBe('สนใจความจุไหนคะ');
  });

  it('LIVE: ชุดเครื่องมือเดิมครบ + prompt เดิมไม่ถูกต่อท้าย', async () => {
    const chat = jest.fn().mockResolvedValue(final('สนใจรุ่นไหนคะ'));
    const { svc } = await buildWith(chat, 'LIVE');
    await svc.generateReply({ text: 'สวัสดี', roomId: 'r1', customerId: null });
    const req = chat.mock.calls[0][0];
    expect(req.tools.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining(['search_products', 'calculate_installment', 'send_rate_card']),
    );
    expect(req.systemPrompt).toBe('PERSONA');
  });

  describe('send_rate_card ประกาศเฉพาะรูปที่ตั้งไว้ (คำตัดสินข้อ 2 · รีวิว TOOLLOOP-1/PROMPT-2)', () => {
    it('ค่าตั้ง prod (เครื่องนอก + แผนที่) → enum มีแค่สองใบ · คำอธิบายไม่เอ่ยตารางเครื่องไทย/มือ 1', async () => {
      const chat = jest.fn().mockResolvedValue(final('สนใจรุ่นไหนคะ'));
      const { svc } = await buildWith(chat, 'NO_STOCK');
      await svc.generateReply({ text: 'สวัสดี', roomId: 'r1', customerId: null });
      const def = chat.mock.calls[0][0].tools.find((t: { name: string }) => t.name === 'send_rate_card');
      expect(def.inputSchema.properties.cards.items.enum).toEqual(['imported_free_down', 'shop_map']);
      expect(def.description).not.toMatch(/used_rate|new_rate/);
    });

    it('ไม่มีรูปที่ตั้งไว้เลย → ไม่ประกาศ send_rate_card (เครื่องมืออื่นครบ)', async () => {
      const chat = jest.fn().mockResolvedValue(final('สนใจรุ่นไหนคะ'));
      const { svc } = await buildWith(chat, 'NO_STOCK', {});
      await svc.generateReply({ text: 'สวัสดี', roomId: 'r1', customerId: null });
      const names = chat.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
      expect(names).not.toContain('send_rate_card');
      expect(names).toEqual(expect.arrayContaining(['get_installment_rates', 'notify_staff']));
    });

    it('buildToolDefinitions: ไม่ส่งค่าตั้ง = ไม่ประกาศ · ส่งค่าตั้ง = enum ตามค่าตั้ง', () => {
      const without = SalesBotService.buildToolDefinitions({ notifyStaff: true }).map((t) => t.name);
      expect(without).not.toContain('send_rate_card');
      expect(without).toContain('notify_staff');
      const withCards = SalesBotService.buildToolDefinitions({ rateCards: PROD_CARDS, notifyStaff: false });
      const def = withCards.find((t) => t.name === 'send_rate_card')!;
      expect((def.inputSchema as any).properties.cards.items.enum).toEqual(['imported_free_down', 'shop_map']);
      expect(withCards.map((t) => t.name)).not.toContain('notify_staff');
    });
  });

  it('send_rate_card → แนบรูปตาราง (ลิงก์ไม่ถึงโมเดล)', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(call('send_rate_card', { cards: ['imported_free_down'] }))
      .mockResolvedValue(final('อันนี้ตารางผ่อนฟรีดาวน์ค่ะ\nสนใจรุ่นไหนคะ'));
    const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
    const r = await svc.generateReply({ text: 'ฟรีดาวน์มีรุ่นไหนบ้าง?', roomId: 'r1', customerId: null });
    expect(sendRateCard.run).toHaveBeenCalledWith({ cards: ['imported_free_down'] });
    expect(r.attachments).toEqual([
      { productId: 'card:imported_free_down', imageUrl: 'https://s.example.com/i.jpg', label: 'ตารางผ่อนฟรีดาวน์' },
    ]);
    const toolMsg = chat.mock.calls[1][0].messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMsg.content).not.toContain('https://');
    expect(JSON.parse(toolMsg.content).systemNote).toBeUndefined();
  });

  it('notify_staff → ส่งห้อง + เหตุผล และความมั่นใจไม่ถูกลด (คำตอบยังส่งถึงลูกค้า)', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(call('notify_staff', { reason: 'iPhone 15 ขอดูรูปเครื่องจริง' }))
      .mockResolvedValue(final('ได้เลยค่ะ เดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ'));
    const { svc, notifyStaff } = await buildWith(chat, 'NO_STOCK');
    const r = await svc.generateReply({ text: 'ขอดูรูปเครื่องจริง', roomId: 'room-9', customerId: null });
    expect(notifyStaff.run).toHaveBeenCalledWith({ reason: 'iPhone 15 ขอดูรูปเครื่องจริง', roomId: 'room-9' });
    expect(r.toolsUsed).toEqual(['notify_staff']);
    expect(r.confidence).toBe(0.95);
  });

  it('เขียนคำตอบมาพร้อม send_rate_card ที่ส่งครบ → จบเทิร์นด้วยข้อความนั้นเลย ไม่วนรอบที่ทำให้ข้อความหาย', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        callWithText('อันนี้ตารางผ่อนฟรีดาวน์ค่ะ\nสนใจรุ่นไหนคะ', 'send_rate_card', { cards: ['imported_free_down'] }),
      )
      .mockResolvedValue(final(''));
    const { svc } = await buildWith(chat, 'NO_STOCK');
    const r = await svc.generateReply({ text: 'ฟรีดาวน์มีรุ่นไหนบ้าง?', roomId: 'r1', customerId: null });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(r.reply).toBe('อันนี้ตารางผ่อนฟรีดาวน์ค่ะ\nสนใจรุ่นไหนคะ');
    expect(r.attachments).toHaveLength(1);
  });

  it('เขียนคำตอบมาพร้อม notify_staff ที่สำเร็จ → จบเทิร์นทันที', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(
        callWithText('ได้เลยค่ะ\nเดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ', 'notify_staff', { reason: 'iPhone 15 ขอรูป' }),
      )
      .mockResolvedValue(final('ไม่ควรถูกเรียก'));
    const { svc } = await buildWith(chat, 'NO_STOCK');
    const r = await svc.generateReply({ text: 'ขอดูรูปเครื่องจริง', roomId: 'r1', customerId: null });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(r.reply).toBe('ได้เลยค่ะ\nเดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ');
  });

  describe('รูปบางใบส่งไม่ได้ → ไม่จบเทิร์น ไม่วนเงียบ: systemNote ในผลเครื่องมือสั่งเขียนคำตอบเต็มใหม่', () => {
    it('มีข้อความมาด้วย → บอกว่าข้อความยังไม่ถึงลูกค้า ให้เขียนใหม่ทั้งหมด (ตัวเลขชุดเดิม) โดยไม่พูดถึงรูปที่ไม่มี', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(
          callWithText('เรทที่ 1 ดาวน์ตามตารางค่ะ\nส่งตารางให้ดูนะคะ', 'send_rate_card', { cards: ['used_rate1'] }),
        )
        .mockResolvedValue(final('เรทที่ 1 ดาวน์ตามตารางค่ะ\nสนใจเรทไหนคะ'));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run.mockResolvedValueOnce({ sent: [], missing: ['used_rate1'], images: [] });
      const r = await svc.generateReply({ text: 'ขอดูเรท', roomId: 'r1', customerId: null });
      expect(chat).toHaveBeenCalledTimes(2);
      const note = toolMessages(chat.mock.calls[1][0])[0].systemNote as string;
      expect(note).toContain('รูป used_rate1 ส่งไม่ได้');
      expect(note).toContain('ยังไม่ถูกส่งถึงลูกค้า');
      expect(note).toContain('เขียนคำตอบทั้งหมดใหม่');
      expect(note).toContain('ห้ามเรียก send_rate_card ขอรูปนี้ซ้ำ');
      // คำสั่งอยู่ในผลเครื่องมือ — ไม่มีข้อความ user แทรก (Gemini ต้องสลับบทบาทเคร่ง)
      const msgs = chat.mock.calls[1][0].messages;
      expect(msgs[msgs.length - 1].role).toBe('tool');
      expect(r.reply).toBe('เรทที่ 1 ดาวน์ตามตารางค่ะ\nสนใจเรทไหนคะ');
    });

    it('เรียกเครื่องมือเฉย ๆ ไม่มีข้อความ → ให้ตอบเป็นข้อความตามปกติ + บอกรูปที่ถึงแล้ว', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(call('send_rate_card', { cards: ['imported_free_down', 'used_rate1'] }))
        .mockResolvedValue(final('อันนี้ตารางค่ะ สนใจรุ่นไหนคะ'));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run.mockResolvedValueOnce({
        sent: [{ card: 'imported_free_down', label: 'ตารางผ่อนฟรีดาวน์' }],
        missing: ['used_rate1'],
        images: [{ id: 'card:imported_free_down', photoUrl: 'https://s.example.com/i.jpg', productName: 'ตารางผ่อนฟรีดาวน์' }],
      });
      const r = await svc.generateReply({ text: 'ขอตาราง', roomId: 'r1', customerId: null });
      const note = toolMessages(chat.mock.calls[1][0])[0].systemNote as string;
      expect(note).toContain('ตอบลูกค้าเป็นข้อความตามปกติ');
      expect(note).toContain('รูปที่ถึงลูกค้าแล้ว: imported_free_down');
      expect(note).not.toContain('ยังไม่ถูกส่งถึงลูกค้า');
      expect(r.attachments).toHaveLength(1);
    });
  });

  describe('กระทบยอด sent/missing กับช่องแนบจริง (รีวิว TOOLLOOP-2 / ATTACH-1)', () => {
    it('LIVE: รูปสินค้า 2 ใบจาก search_products เต็มช่อง → รูปตารางชนะ (ถอดรูปสินค้าใบแรก) และนับว่าส่งแล้ว', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(call('search_products', { query: 'iPhone 13' }))
        .mockResolvedValueOnce(callWithText('iPhone 13 มี 2 เครื่องค่ะ\nร้านอยู่ตามแผนที่นะคะ', 'send_rate_card', { cards: ['shop_map'] }))
        .mockResolvedValue(final('ไม่ควรถูกเรียก'));
      const { svc, searchProducts, sendRateCard } = await buildWith(chat, 'LIVE');
      searchProducts.run.mockResolvedValue({
        groups: [
          {
            units: [
              { id: 'p1', photoUrl: 'https://cdn.example.com/p1.jpg' },
              { id: 'p2', photoUrl: 'https://cdn.example.com/p2.jpg' },
            ],
          },
        ],
      });
      sendRateCard.run.mockResolvedValueOnce({
        sent: [{ card: 'shop_map', label: 'วิธีเดินทางมาร้าน' }],
        missing: [],
        images: [{ id: 'card:shop_map', photoUrl: 'https://s.example.com/map.jpg', productName: 'วิธีเดินทางมาร้าน' }],
      });
      const r = await svc.generateReply({ text: 'iPhone 13 มีไหม ร้านอยู่ไหน', roomId: 'r1', customerId: null });
      expect(chat).toHaveBeenCalledTimes(2);
      expect(r.attachments?.map((a) => a.productId)).toEqual(['p2', 'card:shop_map']);
    });

    it('ช่องเต็มด้วยรูปตารางแล้ว → ใบใหม่ถูกย้ายไป missing + systemNote (ไม่อ้างว่าส่ง)', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(call('send_rate_card', { cards: ['imported_free_down', 'shop_map'] }))
        .mockResolvedValueOnce(callWithText('อันนี้ตารางใหม่ค่ะ', 'send_rate_card', { cards: ['imported_free_down'] }))
        .mockResolvedValue(final('ตารางกับแผนที่ส่งให้แล้วค่ะ สนใจรุ่นไหนคะ'));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run
        .mockResolvedValueOnce({
          sent: [
            { card: 'imported_free_down', label: 'ตารางผ่อนฟรีดาวน์' },
            { card: 'shop_map', label: 'วิธีเดินทางมาร้าน' },
          ],
          missing: [],
          images: [
            { id: 'card:imported_free_down', photoUrl: 'https://s.example.com/i.jpg', productName: 'ตารางผ่อนฟรีดาวน์' },
            { id: 'card:shop_map', photoUrl: 'https://s.example.com/m.jpg', productName: 'วิธีเดินทางมาร้าน' },
          ],
        })
        // เครื่องมือบอกว่าส่งได้ แต่ช่องแนบของคำตอบเต็มด้วยรูปตาราง 2 ใบแล้ว (สมมติรูปคนละไฟล์)
        .mockResolvedValueOnce({
          sent: [{ card: 'used_rate1', label: 'เรท 1' }],
          missing: [],
          images: [{ id: 'card:used_rate1', photoUrl: 'https://s.example.com/u1.jpg', productName: 'เรท 1' }],
        });
      const r = await svc.generateReply({ text: 'ขอตาราง + แผนที่', roomId: 'r1', customerId: null });
      expect(chat).toHaveBeenCalledTimes(3);
      const second = toolMessages(chat.mock.calls[2][0])[1];
      expect(second.sent).toEqual([]);
      expect(second.missing).toEqual(['used_rate1']);
      expect(second.systemNote).toContain('รูป used_rate1 ส่งไม่ได้');
      expect(r.attachments?.map((a) => a.productId)).toEqual(['card:imported_free_down', 'card:shop_map']);
    });
  });

  describe('ตัวเลขไม่มีที่มาในข้อความที่มากับเครื่องมือลงมือแทน (รีวิว TOOLLOOP-3)', () => {
    it('แก้ตัวครั้งเดียว: คำสั่ง SYSTEM GUARD อยู่ในผลเครื่องมือ (ไม่ใช่ข้อความ user) แล้วใช้คำตอบที่เขียนใหม่', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(
          callWithText('ผ่อนเดือนละ 9,999 บาทค่ะ', 'send_rate_card', { cards: ['imported_free_down'] }),
        )
        .mockResolvedValue(final('อันนี้ตารางผ่อนค่ะ สนใจรุ่นไหนคะ'));
      const { svc } = await buildWith(chat, 'NO_STOCK');
      const r = await svc.generateReply({ text: 'ผ่อนเท่าไหร่', roomId: 'r1', customerId: null });
      expect(chat).toHaveBeenCalledTimes(2);
      const req = chat.mock.calls[1][0];
      expect(req.messages[req.messages.length - 1].role).toBe('tool');
      const note = toolMessages(req)[0].systemNote as string;
      expect(note).toContain('[SYSTEM GUARD');
      expect(note).toContain('ยังไม่ถูกส่งถึงลูกค้า');
      expect(note).toContain('ห้ามเรียกซ้ำ');
      expect(r.reply).toBe('อันนี้ตารางผ่อนค่ะ สนใจรุ่นไหนคะ');
    });

    it('ใช้สิทธิ์แก้ตัวไปแล้ว (groundingRetried) → คำตอบรอบถัดไปมั่วอีก = ข้อความสำรอง ไม่แก้ตัวซ้ำ', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(
          callWithText('ผ่อนเดือนละ 9,999 บาทค่ะ', 'notify_staff', { reason: 'ขอราคาเงินสด' }),
        )
        .mockResolvedValue(final('ผ่อนเดือนละ 8,888 บาทค่ะ'));
      const { svc } = await buildWith(chat, 'NO_STOCK');
      const r = await svc.generateReply({ text: 'ผ่อนเท่าไหร่', roomId: 'r1', customerId: null });
      expect(chat).toHaveBeenCalledTimes(2);
      expect(r.reply).toContain('staff');
      expect(r.confidence).toBe(0.3);
    });

    it('แก้ตัวไปแล้วตั้งแต่รอบไม่มีเครื่องมือ → รอบที่มากับ notify_staff มั่วอีก = ข้อความสำรองทันที', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(final('ผ่อนเดือนละ 9,999 บาทค่ะ'))
        .mockResolvedValueOnce(callWithText('ผ่อนเดือนละ 8,888 บาทค่ะ', 'notify_staff', { reason: 'x' }))
        .mockResolvedValue(final('ไม่ควรถูกเรียก'));
      const { svc } = await buildWith(chat, 'NO_STOCK');
      const r = await svc.generateReply({ text: 'ผ่อนเท่าไหร่', roomId: 'r1', customerId: null });
      expect(chat).toHaveBeenCalledTimes(2);
      expect(r.confidence).toBe(0.3);
    });

    it('ข้อความไม่มีตัวเลขแปลก + รูปบางใบหาย → ไม่มีคำสั่ง GUARD (มีแต่หมายเหตุรูป)', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(callWithText('ส่งตารางให้ดูนะคะ', 'send_rate_card', { cards: ['used_rate1'] }))
        .mockResolvedValue(final('สนใจรุ่นไหนคะ'));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run.mockResolvedValueOnce({ sent: [], missing: ['used_rate1'], images: [] });
      await svc.generateReply({ text: 'ขอตาราง', roomId: 'r1', customerId: null });
      const note = toolMessages(chat.mock.calls[1][0])[0].systemNote as string;
      expect(note).not.toContain('SYSTEM GUARD');
    });
  });

  describe('รูปส่งไม่ได้ต้องไม่ทำให้ข้อความที่เขียนแล้วหาย — รอบเขียนใหม่ล้ม = ส่งข้อความเดิม (คำตัดสินข้อ 2 · รีวิว SB-V2/SB-V3)', () => {
    const missingOnly = (card: string) => ({ sent: [], missing: [card], images: [] });

    it('รอบเขียนใหม่ว่าง → ส่งข้อความเดิมที่ผ่านด่านแล้ว (ไม่ใช่ข้อความสำรอง 0.3)', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(
          callWithText('เรทที่ 1 ดาวน์ตามตารางค่ะ\nสนใจเรทไหนคะ', 'send_rate_card', { cards: ['used_rate1'] }),
        )
        .mockResolvedValue(final(''));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run.mockResolvedValueOnce(missingOnly('used_rate1'));
      const r = await svc.generateReply({ text: 'ขอเรท', roomId: 'r1', customerId: null });
      expect(chat).toHaveBeenCalledTimes(2);
      expect(r.reply).toBe('เรทที่ 1 ดาวน์ตามตารางค่ะ\nสนใจเรทไหนคะ');
      expect(r.confidence).toBe(0.95);
      expect(r.attachments).toBeUndefined();
    });

    it('ส่งข้อความเดิม = ตัดบรรทัดที่อ้างรูปซึ่งไม่ได้แนบ · รูปที่แนบได้ยังอ้างได้และแนบไปด้วย', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(
          callWithText('แนบแผนที่ให้แล้วนะคะ\nอันนี้ตารางผ่อนค่ะ\nสนใจรุ่นไหนคะ', 'send_rate_card', {
            cards: ['shop_map', 'used_rate1'],
          }),
        )
        .mockResolvedValue(final(''));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run.mockResolvedValueOnce({
        sent: [{ card: 'shop_map', label: 'วิธีเดินทางมาร้าน' }],
        missing: ['used_rate1'],
        images: [{ id: 'card:shop_map', photoUrl: 'https://s.example.com/m.jpg', productName: 'วิธีเดินทางมาร้าน' }],
      });
      const r = await svc.generateReply({ text: 'ร้านอยู่ไหน ขอตารางด้วย', roomId: 'r1', customerId: null });
      expect(r.reply).toBe('แนบแผนที่ให้แล้วนะคะ\nสนใจรุ่นไหนคะ');
      expect(r.attachments?.map((a) => a.productId)).toEqual(['card:shop_map']);
    });

    it('ข้อความเดิมเหลือแต่คำอ้างรูป → ข้อความสำรองของพนักงานตามเดิม', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(callWithText('ส่งตารางให้ดูนะคะ', 'send_rate_card', { cards: ['used_rate1'] }))
        .mockResolvedValue(final(''));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run.mockResolvedValueOnce(missingOnly('used_rate1'));
      const r = await svc.generateReply({ text: 'ขอตาราง', roomId: 'r1', customerId: null });
      expect(r.confidence).toBe(0.3);
      expect(r.reply).toContain('staff');
    });

    it('รอบเขียนใหม่แต่งตัวเลข → ใช้ข้อความเดิมทันที ไม่เสียรอบแก้ตัวเพิ่ม', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(
          callWithText('เรทที่ 1 ดาวน์ตามตารางค่ะ\nสนใจเรทไหนคะ', 'send_rate_card', { cards: ['used_rate1'] }),
        )
        .mockResolvedValueOnce(final('ผ่อนเดือนละ 9,999 บาทค่ะ'))
        .mockResolvedValue(final('ไม่ควรถูกเรียก'));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run.mockResolvedValueOnce(missingOnly('used_rate1'));
      const r = await svc.generateReply({ text: 'ขอเรท', roomId: 'r1', customerId: null });
      expect(chat).toHaveBeenCalledTimes(2);
      expect(r.reply).toBe('เรทที่ 1 ดาวน์ตามตารางค่ะ\nสนใจเรทไหนคะ');
    });

    it('เรียก send_rate_card โดยไม่ระบุรูป → มีหมายเหตุ (ไม่วนเงียบ) และรอบเขียนใหม่ว่างก็ยังได้ข้อความเดิม', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(
          callWithText('เรทที่ 1 ดาวน์ตามตารางค่ะ\nสนใจเรทไหนคะ', 'send_rate_card', { cards: [] }),
        )
        .mockResolvedValue(final(''));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run.mockResolvedValueOnce(missingOnly(NO_CARD_REQUESTED));
      const r = await svc.generateReply({ text: 'ขอเรท', roomId: 'r1', customerId: null });
      const note = toolMessages(chat.mock.calls[1][0])[0].systemNote as string;
      expect(note).toContain('ไม่ระบุรูป');
      expect(note).toContain('ยังไม่ถูกส่งถึงลูกค้า');
      expect(r.reply).toBe('เรทที่ 1 ดาวน์ตามตารางค่ะ\nสนใจเรทไหนคะ');
    });

    it('ตัวเลขในข้อความเดิมไม่ผ่านด่าน → ไม่เก็บไว้ส่ง (รอบแก้ตัวว่าง = ข้อความสำรอง)', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(
          callWithText('ผ่อนเดือนละ 9,999 บาทค่ะ', 'send_rate_card', { cards: ['used_rate1'] }),
        )
        .mockResolvedValue(final(''));
      const { svc, sendRateCard } = await buildWith(chat, 'NO_STOCK');
      sendRateCard.run.mockResolvedValueOnce(missingOnly('used_rate1'));
      const r = await svc.generateReply({ text: 'ขอเรท', roomId: 'r1', customerId: null });
      expect(r.confidence).toBe(0.3);
      expect(r.reply).not.toContain('9,999');
    });
  });

  it('รอบแก้ตัวที่ตกรอบสุดท้าย (toolChoice none) ไม่สั่งให้เรียกเครื่องมือ (รีวิว TOOLLOOP-6)', async () => {
    const chat = jest.fn();
    for (let i = 0; i < 4; i++) chat.mockResolvedValueOnce(call('get_installment_rates', { query: 'iPhone 15' }, `t${i}`));
    chat
      .mockResolvedValueOnce(final('ผ่อนเดือนละ 7,777 บาทค่ะ')) // hop 4 โดนบล็อก → แก้ตัวที่ hop 5
      .mockResolvedValue(final('สนใจความจุไหนคะ'));
    const { svc, getInstallmentRates } = await buildWith(chat, 'LIVE');
    getInstallmentRates.run.mockResolvedValue({ templates: [] });
    const r = await svc.generateReply({ text: 'ผ่อน 15', roomId: 'r1', customerId: null });
    expect(chat).toHaveBeenCalledTimes(6);
    const lastReq = chat.mock.calls[5][0];
    expect(lastReq.toolChoice).toBe('none');
    const guard = lastReq.messages[lastReq.messages.length - 1].content as string;
    expect(guard).toContain('[SYSTEM GUARD');
    expect(guard).toContain('รอบนี้เรียกเครื่องมือไม่ได้แล้ว');
    expect(guard).not.toMatch(/เรียก (calculate_installment|get_installment_rates)/);
    expect(r.reply).toBe('สนใจความจุไหนคะ');
  });

  describe('recommend_devices ในโหมดไม่มีสต๊อก (รีวิว TOOLLOOP-4)', () => {
    const rawResult = {
      recommended: [
        {
          model: 'iPhone 13', monthlyPrice: 1758, downPayment: 2500, inStock: true, unitCount: 2,
          sampleUnit: { productId: 'p1', batteryHealth: 92, color: 'ม่วงพาสเทล', photoUrl: null },
        },
      ],
      nearMiss: [{ model: 'iPhone 15', monthlyPrice: 3000, inStock: false, unitCount: 0, overBy: { down: 0, monthly: 1000 } }],
      tradeIn: null,
    };

    it('NO_STOCK: ไม่อ่านสต๊อก (ignoreStock) + ตัดฟิลด์สต๊อก/สี/แบตก่อนถึงโมเดล', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(call('recommend_devices', { downBudget: 3000, monthlyBudget: '2,000' }))
        .mockResolvedValue(final('แนะนำ iPhone 13 ค่ะ'));
      const { svc, recommendDevices } = await buildWith(chat, 'NO_STOCK');
      recommendDevices.run.mockResolvedValue(rawResult);
      await svc.generateReply({ text: 'ดาวน์ 3000 ผ่อนไม่เกิน 2000 แนะนำหน่อย', roomId: 'r1', customerId: null });
      expect(recommendDevices.run).toHaveBeenCalledWith(
        { currentModel: undefined, downBudget: 3000, monthlyBudget: 2000, preferStorage: undefined },
        { ignoreStock: true },
      );
      const seen = toolMessages(chat.mock.calls[1][0])[0];
      expect(JSON.stringify(seen)).not.toMatch(/inStock|unitCount|sampleUnit|ม่วงพาสเทล/);
      expect(seen.stockNote).toContain('โหมดไม่มีสต๊อก');
      expect(seen.recommended[0].monthlyPrice).toBe(1758);
    });

    it('LIVE: เรียกแบบเดิม (อาร์กิวเมนต์เดียว) และส่งฟิลด์สต๊อกตามเดิม', async () => {
      const chat = jest
        .fn()
        .mockResolvedValueOnce(call('recommend_devices', { downBudget: 3000 }))
        .mockResolvedValue(final('แนะนำ iPhone 13 ค่ะ'));
      const { svc, recommendDevices } = await buildWith(chat, 'LIVE');
      recommendDevices.run.mockResolvedValue(rawResult);
      await svc.generateReply({ text: 'ดาวน์ 3000 แนะนำหน่อย', roomId: 'r1', customerId: null });
      expect(recommendDevices.run.mock.calls[0]).toHaveLength(1);
      expect(toolMessages(chat.mock.calls[1][0])[0].recommended[0].inStock).toBe(true);
    });
  });

  it('ตัวเลขในข้อความที่มากับ list_promotions (เครื่องมือข้อมูล) → วนต่อตามเดิม', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce(callWithText('ขอเช็คเรทให้นะคะ', 'list_promotions', {}))
      .mockResolvedValue(final('สนใจความจุไหนคะ'));
    const { svc } = await buildWith(chat, 'NO_STOCK');
    (svc as unknown as { listPromotions: { run: jest.Mock } }).listPromotions.run.mockResolvedValue({ promotions: [] });
    const r = await svc.generateReply({ text: 'ผ่อน 15', roomId: 'r1', customerId: null });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(r.reply).toBe('สนใจความจุไหนคะ');
  });

  it('ข้อความสำรองนอกเวลาทำการไม่สัญญา "สักครู่" (synth C03)', async () => {
    const chat = jest.fn().mockResolvedValue(final(''));
    const { svc } = await buildWith(chat, 'NO_STOCK');
    const night = await svc.generateReply({
      text: 'สวัสดี', roomId: 'r1', customerId: null, now: new Date('2026-09-22T14:30:00Z'), // 21:30 น.
    });
    expect(night.reply).toBe('ขออนุญาตให้พี่ staff เช็คข้อมูลเพิ่มเติม แล้วตอบกลับช่วงร้านเปิด 10 โมงนะคะ');
    expect(night.reply).not.toContain('สักครู่');
    expect(night.confidence).toBe(0.3);
    const day = await svc.generateReply({
      text: 'สวัสดี', roomId: 'r1', customerId: null, now: new Date('2026-09-22T05:00:00Z'), // 12:00 น.
    });
    expect(day.reply).toBe(STAFF_FALLBACK_REPLY);
  });

  it('ตัดอักษรจีนที่หลุดมาในคำตอบ', async () => {
    const chat = jest.fn().mockResolvedValue(final('ได้เลยค่ะ\n自 iPhone 16 มือสอง'));
    const { svc } = await buildWith(chat, 'NO_STOCK');
    const r = await svc.generateReply({ text: 'สวัสดี', roomId: 'r1', customerId: null });
    expect(r.reply).toBe('ได้เลยค่ะ\niPhone 16 มือสอง');
  });
});

describe('ตัวช่วยของลูปเครื่องมือ (แชร์กับ bot-eval)', () => {
  it('reconcileRateCardResult: ใบที่ไม่อยู่ในช่องแนบย้ายจาก sent ไป missing · ครบแล้วคืนตัวเดิม', () => {
    const result = {
      sent: [{ card: 'imported_free_down', label: 'a' }, { card: 'shop_map', label: 'b' }],
      missing: ['used_rate1'],
      images: [
        { id: 'card:imported_free_down', photoUrl: 'https://x/a.jpg', productName: 'a' },
        { id: 'card:shop_map', photoUrl: 'https://x/b.jpg', productName: 'b' },
      ],
    };
    const attached = new Map([['card:imported_free_down', { productId: 'card:imported_free_down' }]]);
    expect(reconcileRateCardResult(result, attached)).toEqual({
      sent: [{ card: 'imported_free_down', label: 'a' }],
      missing: ['used_rate1', 'shop_map'],
      images: [{ id: 'card:imported_free_down', photoUrl: 'https://x/a.jpg', productName: 'a' }],
    });
    const all = new Map([
      ['card:imported_free_down', { productId: 'card:imported_free_down' }],
      ['card:shop_map', { productId: 'card:shop_map' }],
    ]);
    expect(reconcileRateCardResult(result, all)).toBe(result);
    expect(reconcileRateCardResult({ error: 'unknown_tool' }, all)).toEqual({ error: 'unknown_tool' });
  });

  it('isCleanSideEffectResult: รูปหายแม้ใบเดียว = ไม่สะอาด', () => {
    expect(isCleanSideEffectResult('send_rate_card', { sent: [{ card: 'a' }], missing: [] })).toBe(true);
    expect(isCleanSideEffectResult('send_rate_card', { sent: [{ card: 'a' }], missing: ['b'] })).toBe(false);
    expect(isCleanSideEffectResult('send_rate_card', { sent: [], missing: [] })).toBe(false);
    expect(isCleanSideEffectResult('notify_staff', { staffNotified: true })).toBe(true);
  });

  it('withSystemNote ต่อท้ายหมายเหตุเดิม ไม่ทับ', () => {
    const a = withSystemNote({ sent: [] }, 'หนึ่ง');
    expect(withSystemNote(a, 'สอง')).toEqual({ sent: [], systemNote: 'หนึ่ง\nสอง' });
    expect(withSystemNote([1], 'x')).toEqual({ result: [1], systemNote: 'x' });
  });

  it('groundingGuardNote: NO_STOCK ไม่เอ่ย calculate_installment · รอบสุดท้ายไม่สั่งเรียกเครื่องมือ', () => {
    const live = groundingGuardNote({ reason: 'r', canCallTools: true, stockMode: 'LIVE', sideEffect: false });
    expect(live).toContain('เรียก calculate_installment (ของในสต็อก) หรือ get_installment_rates (รับออเดอร์) ก่อน');
    const ns = groundingGuardNote({ reason: 'r', canCallTools: true, stockMode: 'NO_STOCK', sideEffect: false });
    expect(ns).toContain('เรียก get_installment_rates ก่อน');
    expect(ns).not.toContain('calculate_installment');
    const last = groundingGuardNote({ reason: 'r', canCallTools: false, stockMode: 'LIVE', sideEffect: true });
    expect(last).not.toMatch(/เรียก (calculate_installment|get_installment_rates)/);
    expect(last).toContain('ตอบเป็นข้อความอย่างเดียว');
    expect(last).toContain('เขียนคำตอบทั้งหมดใหม่');
  });

  it('rateCardMissingNote: ไม่ระบุรูป (NO_CARD_REQUESTED) → ไม่เอ่ยชื่อรูปปลอม แต่ยังสั่งเขียนใหม่', () => {
    const note = rateCardMissingNote({ missing: [NO_CARD_REQUESTED], sent: [], textWasWritten: true });
    expect(note).toContain('ไม่ระบุรูป');
    expect(note).not.toContain(`รูป ${NO_CARD_REQUESTED} ส่งไม่ได้`);
    expect(note).toContain('เขียนคำตอบทั้งหมดใหม่');
    const named = rateCardMissingNote({ missing: ['used_rate1'], sent: ['shop_map'], textWasWritten: false });
    expect(named).toContain('รูป used_rate1 ส่งไม่ได้');
    expect(named).toContain('รูปที่ถึงลูกค้าแล้ว: shop_map');
    expect(named).not.toContain('ไม่ระบุรูป');
  });

  it('stripUnsentImageClaims: ตัดเฉพาะบรรทัดที่อ้างรูปซึ่งไม่ได้แนบ', () => {
    const text = [
      'อันนี้ตารางผ่อนค่ะ',
      'ส่งแผนที่ให้ดูนะคะ',
      'เดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ',
      'เรทที่ 1 ดาวน์ตามตารางค่ะ',
      'ตามตารางนี้ ผ่อน 2,395 x12 ค่ะ',
      'สนใจรุ่นไหนคะ',
    ].join('\n');
    // ไม่มีรูปแนบเลย: ตัดคำอ้างตาราง/แผนที่ · คงคำรับปากของแอดมิน บรรทัดที่มีตัวเลข และบรรทัดที่ไม่อ้างว่าส่ง
    expect(stripUnsentImageClaims(text, [])).toBe(
      [
        'เดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ',
        'เรทที่ 1 ดาวน์ตามตารางค่ะ',
        'ตามตารางนี้ ผ่อน 2,395 x12 ค่ะ',
        'สนใจรุ่นไหนคะ',
      ].join('\n'),
    );
    // แผนที่แนบแล้ว: คำอ้างแผนที่อยู่ได้ · ตารางยังไม่แนบ
    expect(stripUnsentImageClaims(text, ['shop_map'])).toContain('ส่งแผนที่ให้ดูนะคะ');
    expect(stripUnsentImageClaims(text, ['shop_map'])).not.toContain('อันนี้ตารางผ่อนค่ะ');
    // ตารางใดก็ได้แนบแล้ว: คำอ้างตารางอยู่ได้
    expect(stripUnsentImageClaims(text, ['imported_free_down'])).toContain('อันนี้ตารางผ่อนค่ะ');
    // "รูป" เฉย ๆ ตัดเมื่อไม่มีรูปแนบเลยสักใบ
    expect(stripUnsentImageClaims('ส่งรูปให้แล้วค่ะ', [])).toBe('');
    expect(stripUnsentImageClaims('ส่งรูปให้แล้วค่ะ', ['shop_map'])).toBe('ส่งรูปให้แล้วค่ะ');
  });

  it('staffFallbackReply ตามเวลาร้าน (เวลาไทย)', () => {
    expect(staffFallbackReply(new Date('2026-09-22T03:00:00Z'))).toBe(STAFF_FALLBACK_REPLY); // 10:00
    expect(staffFallbackReply(new Date('2026-09-22T12:00:00Z'))).toContain('ช่วงร้านเปิด 10 โมง'); // 19:00
    expect(staffFallbackReply(new Date('2026-09-22T19:00:00Z'))).toContain('ช่วงร้านเปิด 10 โมง'); // 02:00
  });

  it('isBarePromise: เฉพาะคำรับปากสั้น ๆ', () => {
    expect(isBarePromise('ได้ค่ะ')).toBe(true);
    expect(isBarePromise('ส่งได้ค่ะ 🙏')).toBe(true);
    expect(isBarePromise('ยินดีค่ะ 😊')).toBe(false);
    expect(isBarePromise('ได้ค่ะ เดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ')).toBe(false);
    expect(isBarePromise('')).toBe(false);
  });
});

describe('shopClockLine — เวลาร้านต่อหน้าข้อความล่าสุด (2026-09-22)', () => {
  it('เวลาไทย + ในเวลาทำการ', () => {
    // 2026-09-22 03:05 UTC = 10:05 น. เวลาไทย วันอังคาร
    expect(shopClockLine(new Date('2026-09-22T03:05:00Z'))).toBe(
      '[เวลาร้านตอนนี้: อังคาร 22/09 10:05 น. · ในเวลาทำการ (ร้านเปิด 10:00-19:00) — ข้อความระบบ ลูกค้าไม่เห็น]',
    );
  });

  it('19:00 ขึ้นไป / ก่อน 10:00 = นอกเวลาทำการ (ข้ามวันตามเวลาไทย)', () => {
    expect(shopClockLine(new Date('2026-09-22T12:00:00Z'))).toContain('19:00 น. · นอกเวลาทำการ');
    expect(shopClockLine(new Date('2026-09-22T19:30:00Z'))).toContain('พุธ 23/09 02:30 น. · นอกเวลาทำการ');
  });
});
