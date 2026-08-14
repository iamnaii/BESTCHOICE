/**
 * Backfill รูปโปรไฟล์ + ชื่อ ของห้องแชท Facebook ย้อนหลัง — รันวนจนหมด
 *
 * ทำไมต้องมี: getUserProfile รันครั้งเดียวตอนสร้างห้อง ห้องเก่า (~2,000 ห้อง)
 * จึงไม่มีรูป จนกว่า `read_page_mailboxes` ผ่าน App Review (ผ่านแล้ว 2026-08)
 * ปุ่ม backfill ใน Integration Hub กดได้ทีละ 150 ห้อง + axios timeout 15s
 * เด้ง toast ปลอม — CLI นี้เรียก service ตัวเดียวกันแบบวนจนจบในรอบเดียว
 *
 * ใช้:
 *   DATABASE_URL=... npx tsx src/cli/backfill-fb-profiles.cli.ts
 *   LIMIT=200 MAX_ROUNDS=30 ปรับได้; EXPECTED_DB_NAME=<db> กันรันผิด DB
 *
 * เงื่อนไขหยุด: remaining = 0 หรือรอบล่าสุดไม่มีความคืบหน้าเลย
 * (ห้องที่ FB ไม่คืนโปรไฟล์จะค้าง pictureUrl=null ตลอด — วนต่อก็เท่านั้น)
 *
 * ต่อ service ด้วย `new` แทน Nest DI — เหตุผลเดียวกับ train-ai-knowledge.cli.ts:
 * tsx ไม่ emit decorator metadata, Nest DI จะฉีด undefined
 */
import { PrismaClient } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { IntegrationConfigService } from '../modules/integrations/integration-config.service';
import { FacebookAdapter } from '../modules/chat-adapters/facebook.adapter';
import { FacebookBackfillService } from '../modules/chat-adapters/facebook-backfill.service';

const LIMIT = Number(process.env.LIMIT ?? 200);
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS ?? 30);

async function main() {
  const prisma = new PrismaClient();
  const config = {
    get: <T = string>(key: string): T | undefined => process.env[key] as T | undefined,
  } as ConfigService;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const integrationConfig = new IntegrationConfigService(prisma as any, config);
  const backfill = new FacebookBackfillService(
    prisma as any,
    new FacebookAdapter(integrationConfig),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  try {
    const [{ current_database: dbName }] = await prisma.$queryRaw<
      { current_database: string }[]
    >`SELECT current_database()`;
    const expected = process.env.EXPECTED_DB_NAME;
    if (expected && expected !== dbName) {
      throw new Error(`ต่อ DB ผิดตัว — EXPECTED_DB_NAME=${expected} แต่ต่ออยู่กับ ${dbName}`);
    }
    console.log(`DB: ${dbName} · limit ${LIMIT}/รอบ · สูงสุด ${MAX_ROUNDS} รอบ`);

    let totalPics = 0;
    let totalNames = 0;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const s = await backfill.backfillProfiles({ onlyMissingPicture: true, limit: LIMIT });
      totalPics += s.updatedPicture;
      totalNames += s.updatedName;
      console.log(
        `รอบ ${round}: ตรวจ ${s.total} · ได้รูป ${s.updatedPicture} · ได้ชื่อ ${s.updatedName} · ` +
          `ไม่มีโปรไฟล์ ${s.noProfile} · พลาด ${s.failed} · เหลือไม่มีรูป ${s.remaining}` +
          (s.errors.length ? ` · ตัวอย่าง error: ${s.errors[0]}` : ''),
      );
      if (s.remaining === 0) break;
      if (s.updatedPicture === 0 && s.updatedName === 0) {
        console.log('รอบนี้ไม่มีความคืบหน้า — ที่เหลือคือห้องที่ FB ไม่คืนโปรไฟล์ให้ หยุดตรงนี้');
        break;
      }
    }
    console.log(`\nรวมทั้งหมด: ได้รูป ${totalPics} ห้อง · อัปเดตชื่อ ${totalNames} ห้อง`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
