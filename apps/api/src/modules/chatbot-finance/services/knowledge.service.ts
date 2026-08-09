import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel } from '@prisma/client';
import { KB_SEED_ENTRIES } from '../constants/kb-seed-data';
import { scoreKbEntries, type KbMatch } from '../../../utils/kb-match.util';

export type { KbMatch };

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
  channel?: ChatChannel | null;
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
   * channel = null ใน DB แปลว่า "ทุกช่องทาง" — จึงดึงมาคู่กับ FAQ ของช่องที่ระบุเสมอ
   */
  async search(query: string, channel: ChatChannel = ChatChannel.LINE_FINANCE): Promise<KbMatch[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const entries = await this.prisma.chatKnowledgeBase.findMany({
      where: {
        OR: [{ channel: null }, { channel }],
        active: true,
        deletedAt: null,
      },
      orderBy: { priority: 'desc' },
    });

    const scored = scoreKbEntries(normalized, entries);
    if (scored.length > 0) {
      this.logger.log(`[KB] "${query.slice(0, 30)}..." (${channel}) → ${scored.length} match(es)`);
    }
    return scored;
  }

  // ─── Seed ────────────────────────────────────────────────

  /**
   * Seed default KB entries — idempotent (skips existing intents).
   */
  async seedDefaults(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    for (const entry of KB_SEED_ENTRIES) {
      const existing = await this.prisma.chatKnowledgeBase.findFirst({
        where: { intent: entry.intent, deletedAt: null },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await this.prisma.chatKnowledgeBase.create({
        data: {
          channel: ChatChannel.LINE_FINANCE,
          intent: entry.intent,
          category: entry.category,
          triggerKeywords: entry.triggerKeywords,
          exampleQuestions: entry.exampleQuestions,
          responseTemplate: entry.responseTemplate,
          responseType: entry.responseType,
          requiresAuth: entry.requiresAuth ?? true,
          requiresTools: [],
          active: true,
          priority: entry.priority ?? 0,
        },
      });
      created++;
    }

    this.logger.log(`[KB Seed] created=${created}, skipped=${skipped}`);
    return { created, skipped };
  }

  // ─── Admin CRUD ──────────────────────────────────────────

  async listAll(channel?: ChatChannel) {
    return this.prisma.chatKnowledgeBase.findMany({
      where: { deletedAt: null, ...(channel ? { OR: [{ channel: null }, { channel }] } : {}) },
      orderBy: [{ priority: 'desc' }, { intent: 'asc' }],
    });
  }

  async create(input: KbUpsertInput) {
    return this.prisma.chatKnowledgeBase.create({
      data: {
        channel: input.channel === undefined ? ChatChannel.LINE_FINANCE : input.channel,
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
        ...(input.channel !== undefined && { channel: input.channel }),
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
