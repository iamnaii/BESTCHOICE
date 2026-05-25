import { PrismaClient } from '@prisma/client';

/**
 * Backfill CLI — converts legacy CannedResponse.content into a single TEXT bubble.
 *
 * Run with:
 *   set -a && source .env && set +a && npx tsx src/cli/migrate-canned-response-content-to-bubbles.cli.ts
 *
 * Idempotent: skips templates that already have at least one bubble.
 */

const prisma = new PrismaClient();

async function main() {
  const templates = await prisma.cannedResponse.findMany({
    where: { deletedAt: null },
    include: { bubbles: { where: { deletedAt: null } } },
  });

  let created = 0;
  let skippedHasBubbles = 0;
  let skippedNoContent = 0;

  for (const t of templates) {
    if (t.bubbles.length > 0) {
      skippedHasBubbles++;
      continue;
    }
    if (!t.content || !t.content.trim()) {
      skippedNoContent++;
      continue;
    }
    await prisma.cannedResponseBubble.create({
      data: {
        cannedResponseId: t.id,
        type: 'TEXT',
        text: t.content,
        sortOrder: 0,
      },
    });
    created++;
  }

  console.log(`Backfill complete:`);
  console.log(`  - ${created} TEXT bubbles created from content`);
  console.log(`  - ${skippedHasBubbles} templates skipped (already had bubbles)`);
  console.log(`  - ${skippedNoContent} templates skipped (no content)`);
  console.log(`  - ${templates.length} total templates inspected`);
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
