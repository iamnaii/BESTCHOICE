import { Injectable } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { scoreKbEntries, type KbMatch } from '../../../utils/kb-match.util';

export const SEARCH_KNOWLEDGE_BASE_TOOL = {
  name: 'search_knowledge_base',
  description:
    'ค้น FAQ ที่แอดมินเขียนไว้ (เวลาเปิด-ปิด, ที่อยู่สาขา, เงื่อนไขประกัน, วิธีผ่อน, เอกสารที่ต้องใช้ ฯลฯ) ' +
    'ใช้เมื่อคำถามไม่เกี่ยวกับสต็อก/ราคาเครื่องโดยตรง หรือเมื่อไม่แน่ใจคำตอบ — ' +
    'ตอบตาม responseTemplate ที่ได้มา ห้ามแต่งเงื่อนไขเอง. ไม่เจอ → matches: []',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'คำถามของลูกค้า หรือคีย์เวิร์ดที่จะค้น' },
    },
    required: ['query'],
  },
};

/**
 * B3 §5 — FAQ สำหรับบอทขาย
 *
 * ตั้งใจ **ไม่** inject `KnowledgeService` ของ chatbot-finance: การ import
 * ChatbotFinanceModule เข้ามาจะลาก LINE client / OTP / slip pipeline ตามมาทั้งกอง
 * และผูกบอทขายเข้ากับ lifecycle ของอีก pipeline หนึ่ง — ที่ต้องใช้ร่วมกันจริง ๆ
 * มีแค่ "กติกาการให้คะแนน" ซึ่งอยู่ใน `utils/kb-match.util.ts` แล้ว
 */
const SALES_BOT_CHANNELS: ChatChannel[] = [
  ChatChannel.LINE_SHOP,
  ChatChannel.FACEBOOK,
  ChatChannel.WEB,
];

@Injectable()
export class SearchKnowledgeBaseTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { query: string }): Promise<{ matches: KbMatch[] }> {
    const query = String(input?.query ?? '').trim();
    if (!query) return { matches: [] };

    const entries = await this.prisma.chatKnowledgeBase.findMany({
      where: {
        // channel = null คือ FAQ กลางที่ใช้ได้ทุกช่อง (B3 Task 7)
        OR: [{ channel: null }, { channel: { in: SALES_BOT_CHANNELS } }],
        active: true,
        deletedAt: null,
      },
      orderBy: { priority: 'desc' },
    });

    return { matches: scoreKbEntries(query, entries) };
  }
}
