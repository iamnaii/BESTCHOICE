import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductDetectService } from './product-detect.service';
import { AiTrainingService } from './ai-training.service';
import { PersonaService } from './persona.service';
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
    private persona: PersonaService,
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
      // Mock mode: return realistic suggestions when no API key
      return this.getMockSuggestions(roomId);
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

    const personaBase = await this.persona.getBase();
    const systemPrompt = `${personaBase}

# Output format
แนะนำข้อความตอบลูกค้า 2-3 ข้อความ ตอบเป็น JSON array เท่านั้น:
[{"text":"ข้อความ","intent":"answer_price","confidence":0.9}]

intent ที่ใช้ได้: answer_price, answer_spec, answer_stock, answer_promotion, close_sale, ask_preference, greet, follow_up

confidence แนวทาง:
- 0.9+ = มั่นใจมาก (มีตัวอย่างใกล้เคียงในข้อมูลอ้างอิง + ข้อมูลครบ)
- 0.7-0.9 = ค่อนข้างมั่นใจ (ตอบทั่วไปได้)
- 0.5-0.7 = ไม่แน่ใจ (ขอข้อมูลเพิ่ม / handoff ดีกว่า)
- ต่ำกว่า 0.5 = ไม่ควรตอบ ส่งให้แอดมิน`;

    // Fetch few-shot examples from training data — use last customer message for semantic retrieval
    const lastCustomerMsg = [...reversed]
      .reverse()
      .find((m) => m.role === 'CUSTOMER' && m.text)?.text ?? undefined;
    const examples = await this.aiTraining.getFewShotExamples(null, 5, lastCustomerMsg);
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

  /** Mock suggestions when no API key — for dev/demo */
  private async getMockSuggestions(roomId: string): Promise<AiSuggestResponse> {
    const start = Date.now();

    const messages = await this.prisma.chatMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (messages.length === 0) {
      return { suggestions: [], detectedProducts: [], processingTimeMs: 0 };
    }

    const lastCustomerMsg = messages.find((m) => m.role === 'CUSTOMER')?.text?.toLowerCase() ?? '';

    // Generate contextual mock suggestions based on last customer message
    let suggestions: AiSuggestion[] = [];

    if (/ราคา|เท่าไ[ห]?ร่|กี่บาท/.test(lastCustomerMsg)) {
      suggestions = [
        { text: 'ราคาเริ่มต้น 29,900 บาทครับ ผ่อนได้ 6-24 งวด ดาวน์ 30% สนใจดูเงื่อนไขผ่อนไหมครับ?', intent: 'answer_price', confidence: 0.92 },
        { text: 'มีทั้งรุ่น 128GB (29,900) และ 256GB (34,900) ครับ ตอนนี้มีโปรแถมเคส+ฟิล์มด้วยครับ', intent: 'answer_price', confidence: 0.88 },
        { text: 'ส่งรายละเอียดราคาและเงื่อนไขผ่อนให้ทาง LINE เลยนะครับ สะดวกเวลาไหนครับ?', intent: 'close_sale', confidence: 0.75 },
      ];
    } else if (/ผ่อน|งวด|ดาวน์|เงินดาวน์/.test(lastCustomerMsg)) {
      suggestions = [
        { text: 'ผ่อนได้ 6, 10, 12, 24 งวดครับ ดาวน์ขั้นต่ำ 30% ดอกเบี้ย flat rate 1.5%/เดือนครับ', intent: 'answer_price', confidence: 0.90 },
        { text: 'ถ้าผ่อน 12 งวด ดาวน์ 30% งวดละประมาณ 2,500-3,000 บาทครับ อยากให้คำนวณให้ดูไหมครับ?', intent: 'answer_price', confidence: 0.85 },
        { text: 'ใช้แค่บัตรประชาชนตัวจริงกับสลิปเงินเดือนครับ อนุมัติไวภายใน 30 นาทีครับ', intent: 'close_sale', confidence: 0.78 },
      ];
    } else if (/สี|สต็อก|มีไหม|เหลือ|กี่เครื่อง/.test(lastCustomerMsg)) {
      suggestions = [
        { text: 'มีสีดำ, ขาว, และทอง พร้อมส่งทุกสีครับ สนใจสีไหนครับ?', intent: 'answer_stock', confidence: 0.91 },
        { text: 'สีทองยังมีเหลือ 3 เครื่องครับ ถ้าสนใจแนะนำจองไว้ก่อนนะครับ ของหมดเร็ว', intent: 'answer_stock', confidence: 0.87 },
      ];
    } else if (/สาขา|ที่ไหน|เปิด|ปิด|กี่โมง|แผนที่/.test(lastCustomerMsg)) {
      suggestions = [
        { text: 'สาขาลาดพร้าวเปิด 10:00-20:00 ทุกวันครับ อยู่ตรงข้าม MRT ลาดพร้าวครับ', intent: 'answer_spec', confidence: 0.93 },
        { text: 'เปิดทุกวัน 10:00-20:00 ครับ แวะมาดูเครื่องจริงได้เลยครับ จะเตรียมเครื่องไว้ให้ดูนะครับ', intent: 'close_sale', confidence: 0.85 },
      ];
    } else if (/เอกสาร|ต้องใช้อะไร|เตรียม/.test(lastCustomerMsg)) {
      suggestions = [
        { text: 'ใช้แค่บัตรประชาชนตัวจริง + สลิปเงินเดือนล่าสุด 1 ใบครับ อนุมัติไวภายใน 30 นาที', intent: 'answer_spec', confidence: 0.92 },
        { text: 'เอกสารง่ายมากครับ แค่บัตรประชาชน ถ้ามีสเตทเมนต์ย้อนหลัง 3 เดือนยิ่งดีครับ สะดวกมาวันไหนครับ?', intent: 'close_sale', confidence: 0.84 },
      ];
    } else if (/สวัสดี|หวัดดี|ดี/.test(lastCustomerMsg)) {
      suggestions = [
        { text: 'สวัสดีครับ ยินดีให้บริการครับ สนใจสินค้ารุ่นไหนครับ?', intent: 'greet', confidence: 0.95 },
        { text: 'สวัสดีครับ BESTCHOICE ยินดีต้อนรับครับ วันนี้มีโปรพิเศษ ผ่อน 0% 6 งวดครับ', intent: 'greet', confidence: 0.88 },
      ];
    } else {
      suggestions = [
        { text: 'ครับ สนใจสอบถามเพิ่มเติมได้เลยนะครับ ยินดีให้บริการครับ', intent: 'follow_up', confidence: 0.80 },
        { text: 'ต้องการข้อมูลเพิ่มเติมเรื่องไหนครับ? ราคา ผ่อน หรือโปรโมชัน ถามได้เลยครับ', intent: 'ask_preference', confidence: 0.75 },
        { text: 'สะดวกแวะมาดูเครื่องจริงที่สาขาไหมครับ? เปิดทุกวัน 10:00-20:00 ครับ', intent: 'close_sale', confidence: 0.70 },
      ];
    }

    return {
      suggestions,
      detectedProducts: ['iPhone 16 Pro'],
      processingTimeMs: Date.now() - start,
    };
  }
}
