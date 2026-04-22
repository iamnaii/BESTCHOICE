import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service';

export type Intent = 'sales' | 'service' | 'greeting' | 'complaint' | 'unknown';
export type RouteTo = 'sales' | 'service' | 'handoff';

export interface IntentResult {
  intent: Intent;
  confidence: number;
  routeTo: RouteTo;
}

const SYSTEM_PROMPT = `You classify a BESTCHOICE customer chat message into one of:
- sales: asking about product, price, installment, promotion, trade-in
- service: asking about existing contract, payment, due date, balance, receipt
- greeting: hi/hello with no topic yet
- complaint: angry, threatening, mentions legal action or consumer rights
- unknown: unclear

Return ONLY JSON: {"intent": "...", "confidence": 0.0-1.0}`;

@Injectable()
export class ChatIntentRouterService {
  private readonly logger = new Logger(ChatIntentRouterService.name);
  private _client: Anthropic | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private get client(): Anthropic {
    if (!this._client) {
      this._client = new Anthropic();
    }
    return this._client;
  }

  async classify(input: {
    text: string;
    roomId: string;
    customerId: string | null;
    priorMessages?: { role: 'CUSTOMER' | 'STAFF'; text: string }[];
  }): Promise<IntentResult> {
    const userContent = [
      ...(input.priorMessages ?? []).map((m) => `${m.role}: ${m.text}`),
      `CUSTOMER: ${input.text}`,
    ].join('\n');

    const resp = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
    const textBlock = resp.content.find((c) => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { intent: 'unknown', confidence: 0, routeTo: 'handoff' };
    }

    let parsed: { intent: Intent; confidence: number };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return { intent: 'unknown', confidence: 0, routeTo: 'handoff' };
    }

    const routeTo = await this.route(parsed, input.customerId);
    return { ...parsed, routeTo };
  }

  private async route(
    parsed: { intent: Intent; confidence: number },
    customerId: string | null,
  ): Promise<RouteTo> {
    if (parsed.intent === 'complaint') return 'handoff';
    if (parsed.intent === 'unknown' && parsed.confidence < 0.5) return 'handoff';
    if (parsed.intent === 'sales') return 'sales';
    if (parsed.intent === 'service') return 'service';
    if (parsed.intent === 'greeting') {
      if (customerId) {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
          include: {
            contracts: {
              where: { status: 'ACTIVE', deletedAt: null },
              take: 1,
            },
          },
        });
        if (customer?.contracts?.length) return 'service';
      }
      return 'sales';
    }
    return 'handoff';
  }
}
