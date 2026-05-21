import { Injectable, Logger } from '@nestjs/common';
import { PersonaService } from '../staff-chat/services/persona.service';
import { SearchProductsTool, SEARCH_PRODUCTS_TOOL } from './tools/search-products.tool';
import {
  CalculateInstallmentTool,
  CALCULATE_INSTALLMENT_TOOL,
} from './tools/calculate-installment.tool';
import { ListPromotionsTool, LIST_PROMOTIONS_TOOL } from './tools/list-promotions.tool';
import { HandoffToHumanTool, HANDOFF_TO_HUMAN_TOOL } from './tools/handoff-to-human.tool';
import { CaptureLeadTool, CAPTURE_LEAD_TOOL } from './tools/capture-lead.tool';
import { LlmProviderRegistry } from './providers/llm-provider.registry';
import {
  LlmChatMessage,
  LlmToolCall,
  LlmToolDefinition,
} from './providers/llm-provider.interface';

export interface SalesBotInput {
  text: string;
  roomId: string;
  customerId: string | null;
  priorMessages?: { role: 'user' | 'assistant'; content: string }[];
}

export interface SalesBotResult {
  reply: string;
  confidence: number;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
}

const MAX_TOOL_HOPS = 3;

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
    private readonly persona: PersonaService,
  ) {}

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
    ].map(adaptTool);

    const messages: LlmChatMessage[] = [
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
    let totalIn = 0;
    let totalOut = 0;
    let modelUsed = '';

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
        const grounding = this.guardGrounding(resp.text, groundedPrices);
        if (!grounding.ok) {
          this.logger.warn(
            `[GroundingGuard] room=${input.roomId} HALLUCINATION_BLOCKED reason=${grounding.reason} reply=${JSON.stringify(resp.text).slice(0, 200)} grounded=${JSON.stringify([...groundedPrices])}`,
          );
          return {
            reply: 'ขออนุญาตให้พี่ staff เช็คข้อมูลเพิ่มเติมสักครู่นะคะ',
            confidence: 0.3,
            toolsUsed,
            inputTokens: totalIn,
            outputTokens: totalOut,
            modelUsed,
          };
        }
        return {
          reply: resp.text,
          confidence: this.estimateConfidence(resp.text, toolsUsed),
          toolsUsed,
          inputTokens: totalIn,
          outputTokens: totalOut,
          modelUsed,
        };
      }

      // Record + execute every tool call from this turn (typically 1, but
      // models can request several at once).
      const toolResults: LlmChatMessage[] = [];
      for (const tc of resp.toolCalls) {
        toolsUsed.push(tc.name);
        const result = await this.runTool(tc.name, tc.input, input.roomId);
        this.collectGroundedPrices(result, groundedPrices);
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

    return {
      reply: 'ขออนุญาตให้พี่ staff เช็คข้อมูลเพิ่มเติมสักครู่นะคะ',
      confidence: 0.3,
      toolsUsed,
      inputTokens: totalIn,
      outputTokens: totalOut,
      modelUsed,
    };
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
          productId: String(input.productId ?? ''),
          packageChoice: input.packageChoice as 'A' | 'B' | 'C',
          downAmount: Number(input.downAmount ?? 0),
          roomId,
        });
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

  // Walk a tool result and collect every `priceThb` / `monthly` / `minPrice`
  // numeric field. The model can name any of these as a "price" in its reply,
  // so all three are valid grounding sources. We accept Decimal/string/number
  // and coerce to Number — Decimal serialised across the LlmProvider boundary.
  private collectGroundedPrices(value: unknown, into: Set<number>): void {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const v of value) this.collectGroundedPrices(v, into);
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (
          (k === 'priceThb' || k === 'monthly' || k === 'minPrice' || k === 'maxPrice') &&
          v != null
        ) {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) into.add(n);
        }
        this.collectGroundedPrices(v, into);
      }
    }
  }

  // Cheap programmatic grounding guard. After Gemini 2.5 ignored the
  // anti-hallucinate persona rules in PR #1064 and replied "iPhone 15 7,000"
  // though tool only returned iPhone 13 (14,691) + iPhone 16 (17,000), we
  // need a deterministic backstop independent of model behaviour.
  //
  // Rule: every "<number> บาท|฿|baht" mention in the final reply must match
  // (±5%) at least one price the model saw via a tool result this session.
  // Sub-1000 numbers are skipped (could be late fee / interest rate / day
  // count / etc — false-positive risk too high).
  private guardGrounding(
    reply: string,
    grounded: Set<number>,
  ): { ok: true } | { ok: false; reason: string } {
    // Common Thai/English price suffix patterns
    const priceRegex = /([\d][\d,]{2,})\s*(?:บาท|฿|baht|THB)/gi;
    const matches = [...reply.matchAll(priceRegex)];
    if (matches.length === 0) return { ok: true };

    // If the bot mentions ANY price but no tool returned one, it cannot
    // possibly be grounded — block.
    if (grounded.size === 0) {
      return { ok: false, reason: 'price-mentioned-no-tool-result' };
    }

    for (const m of matches) {
      const num = Number(m[1].replace(/,/g, ''));
      if (!Number.isFinite(num) || num < 1000) continue;
      const closeMatch = [...grounded].some((g) => Math.abs(g - num) / g <= 0.05);
      if (!closeMatch) {
        return { ok: false, reason: `unmatched-price=${num}` };
      }
    }
    return { ok: true };
  }
}
