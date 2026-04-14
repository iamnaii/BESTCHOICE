import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel } from '@prisma/client';
import { KB_SEED_ENTRIES } from '../constants/kb-seed-data';

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

    const queryTokens = this.tokenize(normalized);

    const entries = await this.prisma.chatKnowledgeBase.findMany({
      where: {
        channel: ChatChannel.LINE_FINANCE,
        active: true,
        deletedAt: null,
      },
      orderBy: { priority: 'desc' },
    });

    const scored = entries
      .map((e) => {
        let score = 0;
        let keywordMatches = 0;

        // Exact keyword containment (highest weight: 3 pts)
        for (const kw of e.triggerKeywords) {
          if (normalized.includes(kw.toLowerCase())) {
            score += 3;
            keywordMatches++;
          }
        }

        // Token-level fuzzy matching (2 pts per token match)
        for (const kw of e.triggerKeywords) {
          const kwLower = kw.toLowerCase();
          for (const token of queryTokens) {
            if (token.length >= 2 && kwLower.includes(token) && !normalized.includes(kwLower)) {
              score += 2;
              break;
            }
          }
        }

        // Example question similarity (1 pt per match)
        for (const ex of e.exampleQuestions) {
          const exLower = ex.toLowerCase();
          if (normalized.includes(exLower) || exLower.includes(normalized)) {
            score += 1;
          } else {
            // Token overlap between query and example
            const exTokens = this.tokenize(exLower);
            const overlap = queryTokens.filter((t) => t.length >= 2 && exTokens.some((et) => et.includes(t) || t.includes(et)));
            if (overlap.length >= 2) score += 0.5;
          }
        }

        // Priority weight (lower than keyword matches)
        score += e.priority * 0.05;

        // Only return entries with actual keyword/example matches
        const hasRealMatch = keywordMatches > 0 || score > e.priority * 0.05;

        return {
          intent: e.intent,
          category: e.category,
          responseTemplate: e.responseTemplate,
          responseType: e.responseType,
          score: hasRealMatch ? score : 0,
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

  /**
   * Simple Thai tokenizer — splits on spaces, punctuation, and common Thai particles.
   * Not a full NLP tokenizer, but sufficient for keyword matching.
   */
  private tokenize(text: string): string[] {
    // Split on whitespace, punctuation, emoji
    const tokens = text
      .split(/[\s,.\-!?:;()[\]{}/\\|@#$%^&*+=<>~`'"]+/)
      .filter((t) => t.length >= 2);

    // Also split long Thai text on common particles/boundaries
    const thaiParticles = ['ครับ', 'ค่ะ', 'คะ', 'นะ', 'จ้า', 'ไหม', 'หรือ', 'แล้ว', 'ได้', 'ที่', 'ของ', 'ให้', 'กับ', 'จะ', 'อยาก', 'ต้องการ'];
    const extraTokens: string[] = [];
    for (const token of tokens) {
      for (const particle of thaiParticles) {
        const idx = token.indexOf(particle);
        if (idx > 1) {
          extraTokens.push(token.slice(0, idx));
          extraTokens.push(token.slice(idx));
        }
      }
    }

    return [...new Set([...tokens, ...extraTokens])].filter((t) => t.length >= 2);
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
