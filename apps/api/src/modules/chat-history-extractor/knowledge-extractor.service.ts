import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import Anthropic from '@anthropic-ai/sdk';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import {
  ALL_KNOWLEDGE_INTENTS,
  KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT,
  buildKnowledgeExtractionUserMessage,
  type KnowledgeAudience,
} from './prompts/knowledge-extraction.prompt';

interface ExtractedFaq {
  intent: string;
  audience?: KnowledgeAudience;
  triggerKeywords: string[];
  exampleQuestions: string[];
  responseTemplate: string;
  responseType?: string;
  requiresAuth?: boolean;
  frequency?: number;
  confidence?: number;
}
interface ExtractedObjection {
  intent?: string;
  keyword: string;
  audience?: KnowledgeAudience;
  triggerKeywords?: string[];
  exampleQuestions?: string[];
  bestResponse: string;
  frequency?: number;
  confidence?: number;
}

/** ข้อความส่งลูกค้า — คัดออกถ้าหลุดกฎ "ห้ามพูด %/ดอกเบี้ย" (sales-persona กฎเหล็ก #1337) */
const FORBIDDEN_RESPONSE_RE = /ดอกเบี้ย|เปอร์เซ็นต์|%/;

const VALID_INTENTS = new Set<string>(ALL_KNOWLEDGE_INTENTS);
const VALID_RESPONSE_TYPES = new Set(['auto', 'info', 'handoff']);

@Injectable()
export class KnowledgeExtractorService {
  private readonly logger = new Logger(KnowledgeExtractorService.name);
  private readonly client = new Anthropic();
  private static readonly MODEL = 'claude-haiku-4-5-20251001';
  /** ต่ำกว่านี้ = เจอครั้งเดียว/ไม่สอดคล้อง ไม่คุ้มเอาเข้าคลังคำตอบ */
  private static readonly MIN_CONFIDENCE = 0.5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiUsage: AiUsageService,
  ) {}

  async extractAndSeed(): Promise<{ faqsSeeded: number; objectionsSeeded: number }> {
    const pairs = await this.prisma.aiTrainingPair.findMany({
      where: { source: 'SYSTEM_EXTRACT' },
      take: 2000,
      orderBy: { createdAt: 'desc' },
      select: { customerMessage: true, humanEdit: true },
    });
    if (pairs.length === 0) return { faqsSeeded: 0, objectionsSeeded: 0 };

    const resp = await this.client.messages.create({
      model: KnowledgeExtractorService.MODEL,
      max_tokens: 8000,
      system: KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildKnowledgeExtractionUserMessage(pairs) }],
    });

    void this.aiUsage.record({
      service: 'knowledge-extractor',
      method: 'extractAndSeed',
      model: KnowledgeExtractorService.MODEL,
      inputTokens: resp.usage?.input_tokens ?? 0,
      outputTokens: resp.usage?.output_tokens ?? 0,
      status: 'success',
    });

    const textBlock = resp.content.find((c) => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('Claude returned no text');

    const parsed = this.parseResponse(textBlock.text);

    let faqsSeeded = 0;
    for (const faq of parsed.faqs) {
      if (!this.isUsableFaq(faq)) continue;
      await this.prisma.chatKnowledgeBase.upsert({
        where: { id: `extracted:${faq.intent}` },
        create: {
          id: `extracted:${faq.intent}`,
          channel: this.toChannel(faq.audience),
          category: 'EXTRACTED',
          intent: faq.intent,
          triggerKeywords: faq.triggerKeywords ?? [],
          exampleQuestions: faq.exampleQuestions ?? [],
          responseTemplate: faq.responseTemplate,
          responseType: this.toResponseType(faq.responseType),
          requiresAuth: faq.requiresAuth ?? faq.audience !== 'SALES',
          requiresTools: [],
          // แอดมินต้องกดเปิดเองหลังรีวิว — คำตอบที่สกัดจากแชทเก่ายังไม่เคยมีคนตรวจ
          active: false,
          priority: this.toPriority(faq.frequency),
        },
        update: {
          channel: this.toChannel(faq.audience),
          triggerKeywords: faq.triggerKeywords ?? [],
          exampleQuestions: faq.exampleQuestions ?? [],
          responseTemplate: faq.responseTemplate,
          responseType: this.toResponseType(faq.responseType),
          priority: this.toPriority(faq.frequency),
        },
      });
      faqsSeeded++;
    }

    let objectionsSeeded = 0;
    for (const obj of parsed.objections) {
      const intent = this.objectionIntent(obj);
      if (!intent || !this.isUsableText(obj.bestResponse) || this.belowConfidence(obj.confidence)) {
        continue;
      }
      await this.prisma.chatKnowledgeBase.upsert({
        where: { id: `extracted:${intent}` },
        create: {
          id: `extracted:${intent}`,
          channel: this.toChannel(obj.audience ?? 'SALES'),
          category: 'EXTRACTED_OBJECTION',
          intent,
          triggerKeywords: obj.triggerKeywords?.length
            ? obj.triggerKeywords
            : [obj.keyword].filter(Boolean),
          exampleQuestions: obj.exampleQuestions ?? [],
          responseTemplate: obj.bestResponse,
          responseType: 'info',
          requiresAuth: false,
          requiresTools: [],
          active: false,
          priority: this.toPriority(obj.frequency),
        },
        update: {
          channel: this.toChannel(obj.audience ?? 'SALES'),
          triggerKeywords: obj.triggerKeywords?.length
            ? obj.triggerKeywords
            : [obj.keyword].filter(Boolean),
          exampleQuestions: obj.exampleQuestions ?? [],
          responseTemplate: obj.bestResponse,
          priority: this.toPriority(obj.frequency),
        },
      });
      objectionsSeeded++;
    }

    this.logger.log(
      `Extracted ${parsed.faqs.length} FAQs / ${parsed.objections.length} objections from ${pairs.length} pairs ` +
        `→ seeded ${faqsSeeded} FAQs, ${objectionsSeeded} objections (inactive, รอแอดมินรีวิว)`,
    );

    return { faqsSeeded, objectionsSeeded };
  }

  /** Claude บางครั้งหุ้ม JSON ด้วย ```json — ดึงก้อน object แรกออกมาก่อน parse */
  private parseResponse(text: string): { faqs: ExtractedFaq[]; objections: ExtractedObjection[] } {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude returned no JSON object');
    const parsed = JSON.parse(match[0]) as {
      faqs?: ExtractedFaq[];
      objections?: ExtractedObjection[];
    };
    return { faqs: parsed.faqs ?? [], objections: parsed.objections ?? [] };
  }

  private isUsableFaq(faq: ExtractedFaq): boolean {
    if (!faq?.intent || !VALID_INTENTS.has(faq.intent)) {
      this.logger.warn(`ข้าม FAQ intent ที่ไม่อยู่ใน taxonomy: ${faq?.intent}`);
      return false;
    }
    if (this.belowConfidence(faq.confidence)) return false;
    return this.isUsableText(faq.responseTemplate);
  }

  /** คำตอบที่จะส่งลูกค้าต้องมีเนื้อหา และห้ามหลุดคำต้องห้าม */
  private isUsableText(text: string | undefined): boolean {
    if (!text || !text.trim()) return false;
    if (FORBIDDEN_RESPONSE_RE.test(text)) {
      this.logger.warn(`ข้ามคำตอบที่มีคำต้องห้าม (ดอกเบี้ย/%): "${text.slice(0, 40)}…"`);
      return false;
    }
    return true;
  }

  private belowConfidence(confidence: number | undefined): boolean {
    return typeof confidence === 'number' && confidence < KnowledgeExtractorService.MIN_CONFIDENCE;
  }

  private objectionIntent(obj: ExtractedObjection): string | null {
    if (obj?.intent && VALID_INTENTS.has(obj.intent)) return obj.intent;
    this.logger.warn(`ข้าม objection intent ที่ไม่อยู่ใน taxonomy: ${obj?.intent}`);
    return null;
  }

  /**
   * SALES → LINE_SHOP (บอทขายค้นครอบ LINE_SHOP/FACEBOOK/WEB อยู่แล้ว)
   * FINANCE → LINE_FINANCE (น้องเบสเท่านั้น)
   * BOTH → null = ทุกช่องทาง
   *
   * ของเดิม hardcode LINE_FINANCE ทุกแถว — ความรู้ที่สกัดจากแชทขายฝั่ง Facebook
   * จึงไม่มีวันโผล่ใน search_knowledge_base ของบอทขายเลย
   */
  private toChannel(audience: KnowledgeAudience | undefined): ChatChannel | null {
    if (audience === 'FINANCE') return ChatChannel.LINE_FINANCE;
    if (audience === 'BOTH') return null;
    return ChatChannel.LINE_SHOP;
  }

  private toResponseType(responseType: string | undefined): string {
    return responseType && VALID_RESPONSE_TYPES.has(responseType) ? responseType : 'info';
  }

  /** ยิ่งเจอบ่อยยิ่งได้จับคู่ก่อน — cap ไว้ 100 กัน frequency เพี้ยนมากลบ FAQ ที่แอดมินเขียนเอง */
  private toPriority(frequency: number | undefined): number {
    if (typeof frequency !== 'number' || !Number.isFinite(frequency) || frequency < 0) return 0;
    return Math.min(Math.floor(frequency), 100);
  }
}
