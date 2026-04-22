import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import Anthropic from '@anthropic-ai/sdk';

interface ExtractedFaq {
  intent: string;
  triggerKeywords: string[];
  exampleQuestions: string[];
  responseTemplate: string;
}
interface ExtractedObjection {
  keyword: string;
  bestResponse: string;
}

const SYSTEM_PROMPT = `You are extracting FAQ and sales-objection patterns from historical BESTCHOICE chat logs.
Return ONLY valid JSON matching this schema:
{
  "faqs": [{ "intent": string, "triggerKeywords": string[], "exampleQuestions": string[], "responseTemplate": string }],
  "objections": [{ "keyword": string, "bestResponse": string }]
}
Thai text is expected. Merge duplicate FAQs. Pick the BEST staff response as responseTemplate. Max 30 FAQs, 20 objections.`;

@Injectable()
export class KnowledgeExtractorService {
  private readonly logger = new Logger(KnowledgeExtractorService.name);
  private readonly client = new Anthropic();

  constructor(private readonly prisma: PrismaService) {}

  async extractAndSeed(): Promise<{ faqsSeeded: number; objectionsSeeded: number }> {
    const pairs = await this.prisma.aiTrainingPair.findMany({
      where: { source: 'SYSTEM_EXTRACT' },
      take: 2000,
      orderBy: { createdAt: 'desc' },
      select: { customerMessage: true, humanEdit: true },
    });
    if (pairs.length === 0) return { faqsSeeded: 0, objectionsSeeded: 0 };

    const userContent =
      'Here are the chat pairs (customer → staff):\n\n' +
      pairs
        .map((p, i) => `${i + 1}. C: ${p.customerMessage}\n   S: ${p.humanEdit}`)
        .join('\n\n');

    const resp = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
    const textBlock = resp.content.find((c) => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('Claude returned no text');

    const parsed = JSON.parse(textBlock.text) as {
      faqs: ExtractedFaq[];
      objections: ExtractedObjection[];
    };

    for (const faq of parsed.faqs) {
      await this.prisma.chatKnowledgeBase.upsert({
        where: { id: `extracted:${faq.intent}` },
        create: {
          id: `extracted:${faq.intent}`,
          channel: 'LINE_FINANCE',
          category: 'EXTRACTED',
          intent: faq.intent,
          triggerKeywords: faq.triggerKeywords,
          exampleQuestions: faq.exampleQuestions,
          responseTemplate: faq.responseTemplate,
          responseType: 'info',
          requiresAuth: true,
          requiresTools: [],
          active: false,
          priority: 0,
        },
        update: {
          triggerKeywords: faq.triggerKeywords,
          exampleQuestions: faq.exampleQuestions,
          responseTemplate: faq.responseTemplate,
        },
      });
    }

    this.logger.log(
      `Extracted ${parsed.faqs.length} FAQs and ${parsed.objections.length} objections from ${pairs.length} pairs`,
    );

    return { faqsSeeded: parsed.faqs.length, objectionsSeeded: parsed.objections.length };
  }
}
