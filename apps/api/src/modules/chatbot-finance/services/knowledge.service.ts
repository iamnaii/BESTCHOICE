import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel } from '@prisma/client';

export interface KbMatch {
  intent: string;
  category: string;
  responseTemplate: string;
  responseType: string; // 'auto' | 'handoff' | 'info'
  score: number;
}

export interface KbUpsertInput {
  intent: string;
  category: string;
  triggerKeywords: string[];
  exampleQuestions: string[];
  responseTemplate: string;
  responseType: string;
  requiresAuth?: boolean;
  requiresTools?: string[];
  active?: boolean;
  priority?: number;
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

  // ─── Admin CRUD ──────────────────────────────────────────

  async listAll() {
    return this.prisma.chatKnowledgeBase.findMany({
      where: { channel: ChatChannel.LINE_FINANCE, deletedAt: null },
      orderBy: [{ priority: 'desc' }, { intent: 'asc' }],
    });
  }

  async create(input: KbUpsertInput) {
    return this.prisma.chatKnowledgeBase.create({
      data: {
        channel: ChatChannel.LINE_FINANCE,
        intent: input.intent,
        category: input.category,
        triggerKeywords: input.triggerKeywords,
        exampleQuestions: input.exampleQuestions,
        responseTemplate: input.responseTemplate,
        responseType: input.responseType,
        requiresAuth: input.requiresAuth ?? true,
        requiresTools: input.requiresTools ?? [],
        active: input.active ?? true,
        priority: input.priority ?? 0,
      },
    });
  }

  async update(id: string, input: Partial<KbUpsertInput>) {
    const existing = await this.prisma.chatKnowledgeBase.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('ไม่พบ FAQ');
    }
    return this.prisma.chatKnowledgeBase.update({
      where: { id },
      data: {
        ...(input.intent !== undefined && { intent: input.intent }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.triggerKeywords !== undefined && { triggerKeywords: input.triggerKeywords }),
        ...(input.exampleQuestions !== undefined && { exampleQuestions: input.exampleQuestions }),
        ...(input.responseTemplate !== undefined && { responseTemplate: input.responseTemplate }),
        ...(input.responseType !== undefined && { responseType: input.responseType }),
        ...(input.requiresAuth !== undefined && { requiresAuth: input.requiresAuth }),
        ...(input.requiresTools !== undefined && { requiresTools: input.requiresTools }),
        ...(input.active !== undefined && { active: input.active }),
        ...(input.priority !== undefined && { priority: input.priority }),
      },
    });
  }

  /** Soft delete */
  async remove(id: string) {
    const existing = await this.prisma.chatKnowledgeBase.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('ไม่พบ FAQ');
    }
    return this.prisma.chatKnowledgeBase.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }
}
