import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel } from '@prisma/client';

export interface KbMatch {
  intent: string;
  category: string;
  responseTemplate: string;
  responseType: string; // 'auto' | 'handoff' | 'info'
  score: number;
}

/**
 * Knowledge Base — query FAQ entries จาก ChatKnowledgeBase table
 *
 * Strategy: keyword match (Postgres array overlap + ILIKE)
 * Phase E ค่อย upgrade เป็น vector search ถ้าจำเป็น
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * ค้นหา FAQ ที่ตรงกับคำถามลูกค้า
   * @returns top 3 matches เรียงตาม score
   */
  async search(query: string): Promise<KbMatch[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    // ดึง active entries ทั้งหมด (จำนวนน้อย — แค่หลักสิบ)
    const entries = await this.prisma.chatKnowledgeBase.findMany({
      where: {
        channel: ChatChannel.LINE_FINANCE,
        active: true,
        deletedAt: null,
      },
      orderBy: { priority: 'desc' },
    });

    // Score แต่ละ entry
    const scored = entries
      .map((e) => {
        let score = 0;
        // Keyword overlap
        for (const kw of e.triggerKeywords) {
          if (normalized.includes(kw.toLowerCase())) {
            score += 2;
          }
        }
        // Example question similarity (simple substring)
        for (const ex of e.exampleQuestions) {
          if (normalized.includes(ex.toLowerCase()) || ex.toLowerCase().includes(normalized)) {
            score += 1;
          }
        }
        score += e.priority * 0.1;

        return {
          intent: e.intent,
          category: e.category,
          responseTemplate: e.responseTemplate,
          responseType: e.responseType,
          score,
        };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (scored.length > 0) {
      this.logger.log(`[KB] "${query.slice(0, 30)}..." → ${scored.length} match(es)`);
    }
    return scored;
  }
}
