/**
 * Standalone prod seeder: InterestConfig ตั้งต้น (ดอกเบี้ยผ่อน BC) — แก้ no_interest_config
 * ที่ทำให้ "ผ่อนเริ่ม" + เครื่องคิดผ่อนบนเว็บ shop ไม่แสดงตัวเลข
 *
 * ค่าตั้งต้น (owner อนุมัติ 2026-07-22): 0.99%/เดือน (ตรงตัวประมาณบนการ์ด catalog),
 * ดาวน์ขั้นต่ำ 15%, งวด 3-12, commission/vat ตาม default ระบบ (10%/7%)
 * ไม่ seed InterestConfigRate — installment-preview สังเคราะห์ rate×เดือน จาก fallback path
 *
 * นี่คือ config จริงตั้งต้น (ไม่ใช่ demo data): เจ้าของแก้ทีหลังได้ที่
 * staff app → ตั้งค่า → ดอกเบี้ยผ่อน (InterestConfigPage)
 *
 * Idempotent: ถ้ามี InterestConfig ที่ active อยู่แล้ว (ของจริงหรือของ seed เดิม) = ข้าม ไม่ทับ
 * รันบน prod: SEED_FILE=apps/api/prisma/seed-interest-config.ts bash scripts/seed-demo-products-prod.sh
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== InterestConfig starter seed ===');
  const existing = await prisma.interestConfig.findFirst({
    where: { deletedAt: null, isActive: true },
  });
  if (existing) {
    console.log(
      `↷ Skip — active InterestConfig already exists (id=${existing.id}, rate=${existing.interestRate}/mo)`,
    );
    return;
  }
  const created = await prisma.interestConfig.create({
    data: {
      name: 'ผ่อน BESTCHOICE มาตรฐาน (0.99%/เดือน)',
      productCategories: ['PHONE_NEW', 'PHONE_USED'],
      interestRate: 0.0099,
      minDownPaymentPct: 0.15,
      minInstallmentMonths: 3,
      maxInstallmentMonths: 12,
      isActive: true,
    },
  });
  console.log(
    `✅ Created InterestConfig ${created.id} — 0.99%/mo, down≥15%, 3-12 งวด, categories=PHONE_NEW+PHONE_USED`,
  );
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
