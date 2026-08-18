import { Injectable, Logger } from '@nestjs/common';
import { PersonaService } from '../staff-chat/services/persona.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { SearchProductsTool, SEARCH_PRODUCTS_TOOL } from './tools/search-products.tool';
import {
  CalculateInstallmentTool,
  CALCULATE_INSTALLMENT_TOOL,
} from './tools/calculate-installment.tool';
import { ListPromotionsTool, LIST_PROMOTIONS_TOOL } from './tools/list-promotions.tool';
import { HandoffToHumanTool, HANDOFF_TO_HUMAN_TOOL } from './tools/handoff-to-human.tool';
import { CaptureLeadTool, CAPTURE_LEAD_TOOL } from './tools/capture-lead.tool';
import {
  GetInstallmentRatesTool,
  GET_INSTALLMENT_RATES_TOOL,
} from './tools/get-installment-rates.tool';
import {
  SearchKnowledgeBaseTool,
  SEARCH_KNOWLEDGE_BASE_TOOL,
} from './tools/search-knowledge-base.tool';
import { LlmProviderRegistry } from './providers/llm-provider.registry';
import {
  LlmChatMessage,
  LlmToolCall,
  LlmToolDefinition,
} from './providers/llm-provider.interface';
import {
  collectConversationNumbers,
  collectGroundedPrices,
  collectGroundedPricesFromToolText,
  guardGrounding,
} from '../../utils/price-grounding.util';
import {
  collectAttachmentsFromToolResult,
  MAX_BOT_ATTACHMENTS,
  type BotAttachment,
} from '../../utils/bot-attachments.util';

export interface SalesBotInput {
  text: string;
  roomId: string;
  customerId: string | null;
  priorMessages?: { role: 'user' | 'assistant'; content: string }[];
  /**
   * บันทึกสถานะการขายจาก SalesStateService (สมุดสถานะประจำห้อง) — ฉีดเป็นข้อความแรก
   * ของประวัติ ไม่ใช่ system block (system โดน prompt cache; note ต่างกันทุกห้อง)
   */
  sessionNote?: string;
  /** โน้ตเก่ากว่า 48 ชม. — ห้าม seed เลขในโน้ตเป็น grounded (เรทอาจเปลี่ยน ต้องเรียก tool ใหม่) */
  sessionNoteStale?: boolean;
}

export type SalesBotAttachment = BotAttachment; // re-export ชื่อเดิมไว้ให้ผู้เรียกอ่านง่าย

export interface SalesBotResult {
  reply: string;
  confidence: number;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  attachments?: SalesBotAttachment[]; // ← ใหม่ (optional = ผู้เรียกเดิมไม่พัง)
}

// 4 (เดิม 3): เผื่อทางเดิน self-correct ของ GroundingGuard — search(hop0) →
// คำตอบโดนบล็อก+retry(hop1) → โมเดลเรียก calculate/rates เพิ่ม(hop2) → ตอบจริง(hop3)
const MAX_TOOL_HOPS = 4;

/**
 * Convert legacy Anthropic-style tool definition (uses `input_schema`)
 * to the provider-agnostic LlmToolDefinition (uses `inputSchema`).
 *
 * The tool definitions live as constants in each `tools/*.ts` file in
 * Anthropic shape. Rather than touching every file, we do a small adapter
 * here. Once we have confidence on Gemini parity, we can promote
 * LlmToolDefinition into the tool files directly.
 */
function adaptTool(t: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}): LlmToolDefinition {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  };
}

@Injectable()
export class SalesBotService {
  private readonly logger = new Logger(SalesBotService.name);

  constructor(
    private readonly providerRegistry: LlmProviderRegistry,
    private readonly searchProducts: SearchProductsTool,
    private readonly calcInstallment: CalculateInstallmentTool,
    private readonly listPromotions: ListPromotionsTool,
    private readonly handoff: HandoffToHumanTool,
    private readonly captureLead: CaptureLeadTool,
    private readonly getInstallmentRates: GetInstallmentRatesTool,
    private readonly searchKnowledgeBase: SearchKnowledgeBaseTool,
    private readonly persona: PersonaService,
    private readonly aiUsage: AiUsageService,
  ) {}

  private recordUsage(
    modelUsed: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    void this.aiUsage.record({
      service: 'sales-bot',
      method: 'generateReply',
      model: modelUsed || 'unknown',
      inputTokens,
      outputTokens,
      status: 'success',
    });
  }

  /**
   * Generate a SHOP sales reply.
   *
   * Default path: provider is resolved from SystemConfig via LlmProviderRegistry.
   * Bench-test override: pass `explicitProvider` to bypass registry and target
   * a specific provider implementation (used by shop-ai-bench CLI).
   */
  async generateReply(
    input: SalesBotInput,
    explicitProvider?: import('./providers/llm-provider.interface').ILlmProvider,
  ): Promise<SalesBotResult> {
    const tools: LlmToolDefinition[] = [
      SEARCH_PRODUCTS_TOOL,
      CALCULATE_INSTALLMENT_TOOL,
      LIST_PROMOTIONS_TOOL,
      HANDOFF_TO_HUMAN_TOOL,
      CAPTURE_LEAD_TOOL,
      GET_INSTALLMENT_RATES_TOOL,
      SEARCH_KNOWLEDGE_BASE_TOOL,
    ].map(adaptTool);

    const messages: LlmChatMessage[] = [
      ...(input.sessionNote ? [{ role: 'user', content: input.sessionNote } as LlmChatMessage] : []),
      ...(input.priorMessages ?? []).map(
        (m): LlmChatMessage => ({ role: m.role, content: m.content }),
      ),
      { role: 'user', content: input.text },
    ];

    const provider = explicitProvider ?? (await this.providerRegistry.getActive());
    // Resolve persona ONCE per generateReply call (not per hop) so a mid-stream
    // edit from /settings/ai-persona doesn't flip the system prompt halfway
    // through a tool loop. PersonaService cache makes this O(1) most of the
    // time anyway.
    const systemPrompt = await this.persona.getBot();
    const toolsUsed: string[] = [];
    // Grounding ledger: every priceThb the model has seen via tool results
    // this session. Used by guardGrounding() to catch hallucinated prices
    // (e.g. Gemini 2.5 ignored PR #1064 anti-hallucinate rules and replied
    // "iPhone 15 7,000" though tool returned only iPhone 13/16 at 14,691/17,000).
    const groundedPrices = new Set<number>();
    // เลขที่อยู่ในบทสนทนาแล้ว = มีที่มาเช่นกัน (แก้ false positive จากเทสจริง 2026-08-15:
    // ลูกค้าบอกงบ "3000" → บอททวน "งบดาวน์ 3,000 บาท" → โดน block ฐานไม่มี tool result):
    // - เลขที่ลูกค้าพิมพ์เอง (งบ/ยอดที่ต่อรอง) — บอทต้องทวนได้
    // - เลขที่บอทเคยส่งไปแล้วในเทิร์นก่อน — ผ่าน guard ตอนส่งครั้งแรกแล้ว
    //   (เช่น ทวน "เรทที่ 1 ดาวน์ 1,900" หลังลูกค้าเลือก โดยไม่ต้องเรียก tool ซ้ำ)
    collectConversationNumbers(input.text, groundedPrices);
    for (const pm of input.priorMessages ?? []) {
      collectConversationNumbers(pm.content, groundedPrices);
    }
    // เลขในสมุดสถานะ (งบ/เรทที่จดไว้ข้ามวัน) ก็มีที่มาแล้วเช่นกัน — ยกเว้นโน้ตเก่า
    // (>48 ชม.): ราคา/เรทอาจเปลี่ยนแล้ว บังคับให้บอทเรียก tool ใหม่ก่อนทวนตัวเลข
    if (input.sessionNote && !input.sessionNoteStale) {
      collectConversationNumbers(input.sessionNote, groundedPrices);
    }
    // ช่องส่งรูป/ลิงก์ — เติมจาก "ผลลัพธ์ tool" เท่านั้น (deterministic)
    const attachments = new Map<string, BotAttachment>();
    let totalIn = 0;
    let totalOut = 0;
    let modelUsed = '';
    // Distinguishes "the LLM provider blew up" from "a tool (often Prisma-backed)
    // blew up mid-loop" so the AiUsage error row tells an honest story instead of
    // always blaming the provider — see the outer catch below.
    let toolFailed = false;
    // One self-correction retry when guardGrounding blocks a reply — see below.
    let groundingRetried = false;

    try {
      for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
        const resp = await provider.chat({
          systemPrompt,
          messages,
          tools,
        });
        totalIn += resp.inputTokens;
        totalOut += resp.outputTokens;
        modelUsed = resp.modelName;

        if (resp.toolCalls.length === 0) {
          this.logger.log(
            `[FinalReply] room=${input.roomId} hop=${hop} toolsUsed=${JSON.stringify(toolsUsed)} reply=${JSON.stringify(resp.text).slice(0, 400)}`,
          );
          const grounding = guardGrounding(resp.text, groundedPrices);
          if (!grounding.ok) {
            this.logger.warn(
              `[GroundingGuard] room=${input.roomId} HALLUCINATION_BLOCKED reason=${grounding.reason} reply=${JSON.stringify(resp.text).slice(0, 200)} grounded=${JSON.stringify([...groundedPrices])}`,
            );
            // Self-correct ครั้งเดียวก่อนยอมแพ้: ป้อนเหตุผลที่โดนบล็อกกลับให้โมเดล
            // เขียนใหม่ (แทนที่จะเงียบ+handoff ทันที — ลูกค้าไม่ได้คำตอบทั้งที่แค่
            // ตัวเลขไม่มีแหล่ง เช่น Haiku คำนวณค่างวดเองแทนที่จะเรียก tool)
            if (!groundingRetried && hop < MAX_TOOL_HOPS - 1) {
              groundingRetried = true;
              messages.push({ role: 'assistant', content: resp.text });
              messages.push({
                role: 'user',
                content:
                  `[SYSTEM GUARD — ลูกค้าไม่เห็นข้อความนี้ ห้ามเอ่ยถึง] คำตอบล่าสุดถูกบล็อก: ` +
                  `มีตัวเลขที่ไม่ได้มาจากผล tool (${grounding.reason}) — ห้ามคำนวณ/เดา/จำตัวเลขเอง ` +
                  `เขียนคำตอบใหม่ทางใดทางหนึ่ง: (1) ใช้เฉพาะตัวเลขที่ tool คืนมาแล้วในบทสนทนานี้ ` +
                  `(2) ถ้าจะพูดค่างวด เรียก calculate_installment (ของในสต็อก) หรือ get_installment_rates (รับออเดอร์) ก่อน ` +
                  `(3) ตัดตัวเลขที่ไม่มีแหล่งออก แล้วถามขั้นถัดไปตามลำดับการขายแทน`,
              });
              continue;
            }
            this.recordUsage(modelUsed, totalIn, totalOut);
            return {
              reply: 'ขออนุญาตให้พี่ staff เช็คข้อมูลเพิ่มเติมสักครู่นะคะ',
              confidence: 0.3,
              toolsUsed,
              inputTokens: totalIn,
              outputTokens: totalOut,
              modelUsed,
            };
          }
          this.recordUsage(modelUsed, totalIn, totalOut);
          return {
            reply: resp.text,
            confidence: this.estimateConfidence(resp.text, toolsUsed),
            toolsUsed,
            inputTokens: totalIn,
            outputTokens: totalOut,
            modelUsed,
            ...(attachments.size > 0
              ? { attachments: [...attachments.values()].slice(0, MAX_BOT_ATTACHMENTS) }
              : {}),
          };
        }

        // Record + execute every tool call from this turn (typically 1, but
        // models can request several at once — prompt v2.18 encourages calling
        // them together). Execute in PARALLEL: tools are independent reads
        // (search/rates/calc/promotions), so concurrent execution shaves the
        // sum of their latencies down to the max.
        for (const tc of resp.toolCalls) toolsUsed.push(tc.name);
        const executed = await Promise.all(
          resp.toolCalls.map(async (tc) => {
            try {
              return { tc, result: await this.runTool(tc.name, tc.input, input.roomId) };
            } catch (toolError) {
              // Tag before rethrow — tools are Prisma-backed and can throw for
              // reasons that have nothing to do with the LLM provider (DB down,
              // constraint violation, etc). The outer catch reads this flag to
              // record an honest errorKind instead of always blaming the provider.
              toolFailed = true;
              throw toolError;
            }
          }),
        );
        const toolResults: LlmChatMessage[] = [];
        for (const { tc, result } of executed) {
          collectGroundedPrices(result, groundedPrices);
          collectGroundedPricesFromToolText(tc.name, result, groundedPrices);
          collectAttachmentsFromToolResult(tc.name, result, attachments);
          this.logger.log(
            `[ToolCall] room=${input.roomId} tool=${tc.name} args=${JSON.stringify(tc.input).slice(0, 300)} result=${JSON.stringify(result).slice(0, 600)}`,
          );
          toolResults.push({
            role: 'tool',
            toolCallId: tc.id,
            content: JSON.stringify(result),
          });
        }

        // Conversation grows: assistant turn (text + tool_calls) then tool results.
        messages.push({
          role: 'assistant',
          content: resp.text,
          toolCalls: resp.toolCalls,
        });
        messages.push(...toolResults);
      }

      this.recordUsage(modelUsed, totalIn, totalOut);
      return {
        reply: 'ขออนุญาตให้พี่ staff เช็คข้อมูลเพิ่มเติมสักครู่นะคะ',
        confidence: 0.3,
        toolsUsed,
        inputTokens: totalIn,
        outputTokens: totalOut,
        modelUsed,
      };
    } catch (error) {
      void this.aiUsage.record({
        service: 'sales-bot',
        method: 'generateReply',
        model: modelUsed || 'unknown',
        inputTokens: totalIn,
        outputTokens: totalOut,
        status: 'error',
        errorKind: toolFailed ? 'tool_error' : 'provider_error',
      });
      throw error;
    }
  }

  private async runTool(
    name: string,
    input: Record<string, unknown>,
    roomId: string,
  ): Promise<unknown> {
    switch (name) {
      case 'search_products':
        return this.searchProducts.run(input as { query: string; maxPriceThb?: number });
      case 'calculate_installment':
        return this.calcInstallment.run(
          input as { productId: string; downPct?: number; tenureMonths: number },
        );
      case 'list_promotions':
        return this.listPromotions.run(input as { productId?: string });
      case 'handoff_to_human':
        return this.handoff.run({
          reason: String(input.reason ?? 'bot_uncertain'),
          roomId,
        });
      case 'capture_lead':
        return this.captureLead.run({
          customerName: String(input.customerName ?? ''),
          phone: String(input.phone ?? ''),
          address: input.address as string | undefined,
          productId: input.productId ? String(input.productId) : undefined,
          packageChoice: input.packageChoice as 'A' | 'B' | 'C' | undefined,
          productNote: input.productNote ? String(input.productNote) : undefined,
          downAmount: Number(input.downAmount ?? 0),
          roomId,
        });
      case 'get_installment_rates':
        return this.getInstallmentRates.run(input);
      case 'search_knowledge_base':
        return this.searchKnowledgeBase.run({ query: String(input.query ?? '') });
      default:
        return { error: 'unknown_tool' };
    }
  }

  /**
   * Confidence used by AiAutoReplyService threshold gating (default 0.80).
   *
   * Mapping (Phase A — see spec §6 #5):
   * - handoff_to_human used        → 0.3  (signal to handoff path, do not auto-send)
   * - short/incomplete (< 20 char) → 0.6  (below default threshold; skip)
   * - tool-used reply              → 0.95 (high confidence: fact-grounded)
   * - greeting/qualifier (no tool) → 0.9  (high: opener doesn't need data)
   */
  private estimateConfidence(reply: string, toolsUsed: string[]): number {
    if (toolsUsed.includes('handoff_to_human')) return 0.3;
    if (reply.trim().length < 20) return 0.6;
    if (toolsUsed.length > 0) return 0.95;
    return 0.9;
  }
}
