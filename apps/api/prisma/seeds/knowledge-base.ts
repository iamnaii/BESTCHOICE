import { PrismaClient, ChatChannel } from '@prisma/client';
import { KB_SEED_ENTRIES } from '../../src/modules/chatbot-finance/constants/kb-seed-data';

/**
 * Seed default FAQ entries for Finance Bot — idempotent (skips existing intents).
 */
export async function seedKnowledgeBase(
  prisma: PrismaClient,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const entry of KB_SEED_ENTRIES) {
    const existing = await prisma.chatKnowledgeBase.findFirst({
      where: { intent: entry.intent, deletedAt: null },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.chatKnowledgeBase.create({
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

  console.log(`[KB Seed] created=${created}, skipped=${skipped}`);
  return { created, skipped };
}
