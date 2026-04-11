import { Controller, Post, Query, Logger, ForbiddenException } from '@nestjs/common';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { KnowledgeService } from './services/knowledge.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KB_SEED_ENTRIES } from './constants/kb-seed-data';

/**
 * One-time KB seed endpoint — no auth required, protected by secret query param.
 * DELETE THIS CONTROLLER after seeding production.
 */
@Controller('chatbot/finance/seed')
@SkipCsrf()
export class ChatbotFinanceSeedController {
  private readonly logger = new Logger(ChatbotFinanceSeedController.name);

  constructor(
    private knowledge: KnowledgeService,
    private prisma: PrismaService,
  ) {}

  @Post()
  async seed(@Query('secret') secret?: string) {
    const expected = process.env.JWT_SECRET || 'seed-kb-secret';
    if (secret !== expected) {
      throw new ForbiddenException('Invalid seed secret');
    }

    let created = 0;
    let updated = 0;

    for (const entry of KB_SEED_ENTRIES) {
      const existing = await this.prisma.chatKnowledgeBase.findFirst({
        where: { channel: 'LINE_FINANCE', intent: entry.intent },
      });

      if (existing) {
        await this.prisma.chatKnowledgeBase.update({
          where: { id: existing.id },
          data: { ...entry, active: true },
        });
        updated++;
      } else {
        await this.knowledge.create(entry);
        created++;
      }
    }

    this.logger.log(`[KB Seed] Created: ${created}, Updated: ${updated}`);
    return { success: true, created, updated, total: KB_SEED_ENTRIES.length };
  }
}
