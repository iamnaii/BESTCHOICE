import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { SALES_BOT_SYSTEM_PROMPT } from './prompts/sales-bot.system';
import { SearchProductsTool, SEARCH_PRODUCTS_TOOL } from './tools/search-products.tool';
import {
  CalculateInstallmentTool,
  CALCULATE_INSTALLMENT_TOOL,
} from './tools/calculate-installment.tool';
import { ListPromotionsTool, LIST_PROMOTIONS_TOOL } from './tools/list-promotions.tool';
import { HandoffToHumanTool, HANDOFF_TO_HUMAN_TOOL } from './tools/handoff-to-human.tool';

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
}

@Injectable()
export class SalesBotService {
  private readonly logger = new Logger(SalesBotService.name);
  private _client: Anthropic | null = null;
  private get client(): Anthropic {
    if (!this._client) {
      this._client = new Anthropic();
    }
    return this._client;
  }

  constructor(
    private readonly searchProducts: SearchProductsTool,
    private readonly calcInstallment: CalculateInstallmentTool,
    private readonly listPromotions: ListPromotionsTool,
    private readonly handoff: HandoffToHumanTool,
  ) {}

  async generateReply(input: SalesBotInput): Promise<SalesBotResult> {
    const tools = [
      SEARCH_PRODUCTS_TOOL,
      CALCULATE_INSTALLMENT_TOOL,
      LIST_PROMOTIONS_TOOL,
      HANDOFF_TO_HUMAN_TOOL,
    ];
    const messages: Anthropic.MessageParam[] = [
      ...(input.priorMessages ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: input.text },
    ];

    const toolsUsed: string[] = [];
    let totalIn = 0;
    let totalOut = 0;

    for (let hop = 0; hop < 3; hop++) {
      const resp = await this.client.messages.create({
        // Customer-facing reply loop — Sonnet for quality. Do NOT drop to Haiku.
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SALES_BOT_SYSTEM_PROMPT,
        tools: tools as Anthropic.Tool[],
        messages,
      });
      totalIn += resp.usage.input_tokens;
      totalOut += resp.usage.output_tokens;

      const toolUse = resp.content.find((c) => c.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        const text = resp.content.find((c) => c.type === 'text');
        const reply = text && text.type === 'text' ? text.text : '';
        return {
          reply,
          confidence: this.estimateConfidence(reply, toolsUsed),
          toolsUsed,
          inputTokens: totalIn,
          outputTokens: totalOut,
        };
      }

      toolsUsed.push(toolUse.name);
      const toolResult = await this.runTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        input.roomId,
      );

      messages.push({ role: 'assistant', content: resp.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(toolResult),
          },
        ],
      });
    }

    return {
      reply: 'ขออนุญาตให้พี่ staff เช็คข้อมูลเพิ่มเติมสักครู่นะคะ',
      confidence: 0.3,
      toolsUsed,
      inputTokens: totalIn,
      outputTokens: totalOut,
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
      default:
        return { error: 'unknown_tool' };
    }
  }

  private estimateConfidence(reply: string, toolsUsed: string[]): number {
    if (reply.length < 10) return 0.3;
    if (toolsUsed.includes('handoff_to_human')) return 0.2;
    if (toolsUsed.length === 0) return 0.5;
    return 0.8;
  }
}
