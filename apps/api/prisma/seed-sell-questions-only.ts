/**
 * Standalone prod seeder: buyback/sell questionnaire ONLY (8 กลุ่มคำถาม).
 *
 * ทำไมต้องมีไฟล์นี้: seedBuybackQuestions ถูก wire ไว้ใน seed.ts (dev) เท่านั้น —
 * seed-production.ts ไม่มี และการรัน seed.ts เต็มบน prod อันตราย (test accounts ฯลฯ)
 * ไฟล์นี้ = master-data เดียวล้วน, idempotent (ข้าม key ที่เคยมี รวม soft-deleted),
 * ไม่แตะตารางอื่นใดทั้งสิ้น — จงใจไม่รวม seedTradeInValuations เพราะราคาเป็น
 * ข้อเสนอเงินสดต่อลูกค้า owner ต้องกรอกราคาจริงผ่านแท็บ "ตารางราคากลาง" เอง
 *
 * รันบน prod ผ่าน one-shot Cloud Run Job: bash scripts/seed-sell-prod.sh
 * (pattern เดียวกับ scripts/seed-coa-prod.sh)
 */
import { PrismaClient } from '@prisma/client';
import { seedBuybackQuestions } from './seeds/buyback-questions';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Sell Questionnaire Seed (questions only) ===');
  await seedBuybackQuestions(prisma);
  const count = await prisma.buybackQuestion.count({ where: { deletedAt: null } });
  console.log(`✅ Done — active questions in DB: ${count}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
