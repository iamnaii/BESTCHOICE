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
}
