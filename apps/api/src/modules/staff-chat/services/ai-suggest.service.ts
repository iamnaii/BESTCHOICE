import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductDetectService } from './product-detect.service';
import { AiTrainingService } from './ai-training.service';
import type { AiSuggestion, AiSuggestResponse } from '../dto/ai-suggest.dto';

@Injectable()
export class AiSuggestService {
  private readonly logger = new Logger(AiSuggestService.name);
  private anthropic: Anthropic | null = null;
  private readonly MODEL = 'claude-haiku-4-5-20251001';

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private productDetect: ProductDetectService,
    private aiTraining: AiTrainingService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — AI suggest disabled');
    }
  }

  async suggest(roomId: string, currentDraft?: string): Promise<AiSuggestResponse> {
    const start = Date.now();

    if (!this.anthropic) {
      return { suggestions: [], detectedProducts: [], processingTimeMs: 0 };
    }

    // 1. Fetch conversation
    const messages = await this.prisma.chatMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { staff: { select: { name: true } } },
    });

    if (messages.length === 0) {
      return { suggestions: [], detectedProducts: [], processingTimeMs: Date.now() - start };
    }

    const reversed = [...messages].reverse();

    // 2. Detect products
    const messageTexts = reversed.filter((m) => m.text).map((m) => m.text!);
    const products = await this.productDetect.detectProducts(messageTexts);

    // 3. Customer info
    const session = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      include: {
        customer: {
          include: {
            contracts: { where: { deletedAt: null }, take: 3, orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });

    // 4. Active promotions
    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: { deletedAt: null, isActive: true, startDate: { lte: now }, endDate: { gte: now } },
      take: 5,
    });

    // 5. Build prompt
    const conversationText = reversed
      .map((m) => {
        const role =
          m.role === 'STAFF'
            ? `พนักงาน${m.staff?.name ? ` (${m.staff.name})` : ''}`
            : m.role === 'CUSTOMER'
              ? 'ลูกค้า'
              : 'ระบบ';
        return `${role}: ${m.text ?? '[ไฟล์/รูปภาพ]'}`;
      })
      .join('\n');

    const productContext =
      products.length > 0
        ? products
            .map((p) => {
              const pricing =
                p.pricingOptions.length > 0
                  ? p.pricingOptions
                      .map(
                        (o) =>
                          `ผ่อน ${o.installments} งวด งวดละ ${o.monthlyPayment.toLocaleString()} บาท (ดาวน์ ${o.downPaymentMin}%)`,
                      )
                      .join(', ')
                  : 'ไม่มีข้อมูลผ่อน';
              const promos =
                p.activePromotions.length > 0
                  ? p.activePromotions.map((pr) => pr.name).join(', ')
                  : 'ไม่มีโปรโมชัน';
              return `- ${p.name} | ราคา ${p.price.toLocaleString()} บาท | สต็อก ${p.stock} เครื่อง | ${pricing} | โปร: ${promos}`;
            })
            .join('\n')
        : 'ไม่พบสินค้าที่เกี่ยวข้อง';

    const customerContext = session?.customer
      ? `ลูกค้า: ${session.customer.name} | สัญญาที่มี: ${session.customer.contracts.length} สัญญา`
      : 'ลูกค้าใหม่ (ยังไม่ระบุตัวตน)';

    const promoContext =
      promotions.length > 0
        ? promotions.map((p) => `- ${p.name}: ${p.description ?? ''}`).join('\n')
        : 'ไม่มีโปรโมชันที่ active';

    const systemPrompt = `คุณเป็น AI ช่วยพนักงานขายร้านมือถือ BESTCHOICE ตอบแชทลูกค้า
คุณต้องแนะนำข้อความตอบลูกค้าให้พนักงานเลือก (2-3 ข้อความ)

กฎ:
- ข้อความต้องสุภาพ เป็นมิตร ใช้ครับ/ค่ะ
- ใส่ข้อมูลราคา/ผ่อน/โปรโมชัน ถ้าเกี่ยวข้อง
- พยายามปิดการขาย (ถามว่าสนใจไหม, อยากดูเงื่อนไขไหม, จะจองไหม)
- ข้อความสั้นกระชับ ไม่เกิน 3 บรรทัด
- ตอบเป็นภาษาไทย

ตอบเป็น JSON array เท่านั้น:
[{"text":"ข้อความ","intent":"answer_price","confidence":0.9}]

intent ที่ใช้ได้: answer_price, answer_spec, answer_stock, answer_promotion, close_sale, ask_preference, greet, follow_up`;

    // Fetch few-shot examples from training data
    const examples = await this.aiTraining.getFewShotExamples(null, 5);
    const examplesText =
      examples.length > 0
        ? '## ตัวอย่างข้อความที่ดีจากพนักงาน\n\n' +
          examples
            .map((ex) => `ลูกค้า: "${ex.customerMessage}"\nพนักงาน: "${ex.staffResponse}"`)
            .join('\n\n')
        : '';

    const userMessage = `## ข้อมูลลูกค้า\n${customerContext}\n\n## สินค้าที่เกี่ยวข้อง\n${productContext}\n\n## โปรโมชันที่ active\n${promoContext}\n\n${examplesText ? examplesText + '\n\n' : ''}## บทสนทนา\n${conversationText}\n\n${currentDraft ? `## ข้อความที่พนักงานกำลังพิมพ์\n${currentDraft}` : ''}\n\nแนะนำข้อความตอบ 2-3 ข้อความ:`;

    try {
      const response = await this.anthropic.messages.create({
        model: this.MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return {
          suggestions: [],
          detectedProducts: products.map((p) => p.name),
          processingTimeMs: Date.now() - start,
        };
      }

      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return {
          suggestions: [],
          detectedProducts: products.map((p) => p.name),
          processingTimeMs: Date.now() - start,
        };
      }

      const suggestions: AiSuggestion[] = JSON.parse(jsonMatch[0]);
      return {
        suggestions: suggestions.slice(0, 3),
        detectedProducts: products.map((p) => p.name),
        processingTimeMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error('AI suggest failed', error);
      return {
        suggestions: [],
        detectedProducts: products.map((p) => p.name),
        processingTimeMs: Date.now() - start,
      };
    }
  }
}
