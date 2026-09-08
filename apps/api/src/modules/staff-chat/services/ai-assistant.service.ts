import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiTextService } from '../../ai-usage/ai-text.service';

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private summaryCache = new Map<string, { text: string; expiresAt: number }>();

  private static readonly MODEL = 'claude-haiku-4-5-20251001';
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private prisma: PrismaService,
    private aiText: AiTextService,
  ) {}

  /**
   * Summarize a chat room's conversation in 2-3 Thai sentences.
   * Results are cached for 5 minutes per room.
   */
  async summarizeConversation(roomId: string, userId?: string): Promise<string> {
    // 1. Check cache
    const cached = this.summaryCache.get(roomId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.text;
    }

    if (!this.aiText.isAvailable) {
      return 'ไม่สามารถสรุปได้ — ยังไม่ได้ตั้งค่า API key';
    }

    try {
      // 2. Get last 50 messages from DB
      const messages = await this.prisma.chatMessage.findMany({
        where: { roomId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          role: true,
          text: true,
          createdAt: true,
          staffId: true,
          staff: { select: { name: true } },
        },
      });

      if (messages.length === 0) {
        return 'ยังไม่มีข้อความในบทสนทนานี้';
      }

      // 3. Build conversation text (chronological order)
      const conversationText = messages
        .reverse()
        .map((m) => {
          const sender =
            m.role === 'STAFF'
              ? `พนักงาน${m.staff?.name ? ` (${m.staff.name})` : ''}`
              : m.role === 'CUSTOMER'
                ? 'ลูกค้า'
                : 'ระบบ';
          return `${sender}: ${m.text || '[ไม่มีข้อความ]'}`;
        })
        .join('\n');

      // 4. Call Claude haiku
      const text = await this.aiText.generate(
        {
          model: AiAssistantService.MODEL,
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: `สรุปบทสนทนานี้ใน 2-3 ประโยค ภาษาไทย:\n\n${conversationText}`,
            },
          ],
        },
        {
          service: 'ai-assistant',
          method: 'summarizeConversation',
          ...(userId ? { userId } : {}),
        },
      );

      const summary = text ?? 'ไม่สามารถสรุปได้';

      // 5. Cache result
      this.summaryCache.set(roomId, {
        text: summary,
        expiresAt: Date.now() + AiAssistantService.CACHE_TTL_MS,
      });

      return summary;
    } catch (error) {
      this.logger.error(`Failed to summarize room ${roomId}`, error);
      return 'ไม่สามารถสรุปได้';
    }
  }

  /**
   * Adjust the tone of a message text.
   */
  async adjustTone(text: string, tone: 'formal' | 'casual' | 'friendly', userId?: string): Promise<string> {
    if (!this.aiText.isAvailable) {
      return text;
    }

    const tonePrompts: Record<string, string> = {
      formal: 'เขียนข้อความนี้ใหม่ให้สุภาพเป็นทางการ ตอบเฉพาะข้อความที่เขียนใหม่เท่านั้น:',
      casual: 'เขียนข้อความนี้ใหม่ให้เป็นกันเอง ตอบเฉพาะข้อความที่เขียนใหม่เท่านั้น:',
      friendly: 'เขียนข้อความนี้ใหม่ให้เป็นมิตรอบอุ่น ตอบเฉพาะข้อความที่เขียนใหม่เท่านั้น:',
    };

    try {
      const adjusted = await this.aiText.generate(
        {
          model: AiAssistantService.MODEL,
          max_tokens: 500,
          messages: [
            {
              role: 'user',
              content: `${tonePrompts[tone]}\n\n${text}`,
            },
          ],
        },
        {
          service: 'ai-assistant',
          method: 'adjustTone',
          ...(userId ? { userId } : {}),
        },
      );

      return adjusted ?? text;
    } catch (error) {
      this.logger.error('Failed to adjust tone', error);
      return text;
    }
  }
}
