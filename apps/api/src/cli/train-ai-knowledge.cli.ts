/**
 * เทรน AI ตอบลูกค้าจากประวัติแชทเก่า — รันทีเดียวจบทั้ง 2 ขั้น
 *
 *   ขั้น 1  ดูดแชท LINE + Facebook ย้อนหลัง → จับคู่ "ลูกค้าถาม → พนักงานตอบ" → ai_training_pairs
 *   ขั้น 2  ให้ Claude สรุปเป็น FAQ + วิธีตอบข้อโต้แย้ง → chat_knowledge_base (active = false)
 *
 * ทำไมต้องมี CLI ทั้งที่มี endpoint อยู่แล้ว: endpoint 2 ตัวนั้นต้อง login เอา JWT +
 * ใส่ header CsrfGuard + ยิงตามลำดับเอง ซึ่งพังง่ายเวลารันมือ. CLI นี้เรียก service
 * ตัวเดียวกันตรง ๆ — ตรรกะ ตัวกรอง และการเขียน DB เป็นชุดเดียวกันเป๊ะ ไม่มีทางหลุดกัน
 *
 * ใช้:
 *   npm --prefix apps/api run ai:train                    # ทั้ง 2 ขั้น ย้อนหลัง 12 เดือน
 *   MONTHS=6 npm --prefix apps/api run ai:train           # เปลี่ยนช่วงเวลา
 *   SKIP_EXTRACT=1 npm --prefix apps/api run ai:train     # ข้ามขั้น 1 (แก้ prompt แล้วสกัดใหม่จากคู่ข้อความเดิม)
 *   DRY_RUN=1 npm --prefix apps/api run ai:train          # นับอย่างเดียว ไม่เขียน ไม่เรียก Claude
 *
 * env ที่เกี่ยว: DATABASE_URL (บังคับ) · ANTHROPIC_API_KEY (บังคับเฉพาะขั้น 2) ·
 *               EXPECTED_DB_NAME (ถ้าตั้ง จะตรวจว่าต่อ DB ถูกตัวก่อนเขียน)
 */
import { PrismaClient } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { IntegrationConfigService } from '../modules/integrations/integration-config.service';
import { ChatHistoryExtractorService } from '../modules/chat-history-extractor/chat-history-extractor.service';
import { KnowledgeExtractorService } from '../modules/chat-history-extractor/knowledge-extractor.service';
import { LineExtractorSource } from '../modules/chat-history-extractor/sources/line-extractor.source';
import { FacebookExtractorSource } from '../modules/chat-history-extractor/sources/facebook-extractor.source';
import { AiUsageService } from '../modules/ai-usage/ai-usage.service';

/**
 * ต่อ service เองด้วย `new` แทนการบูต Nest DI — ตั้งใจ ไม่ใช่ทางลัด:
 * script นี้รันด้วย `tsx` (esbuild) ซึ่ง **ไม่ emit decorator metadata**
 * (`design:paramtypes` เป็น undefined) → Nest DI จะฉีด dependency เป็น undefined
 * แล้วพังตอน onModuleInit. CLI ตัวอื่นในโปรเจคที่ใช้ Nest DI จึงต้องรันจาก
 * `dist/` หลัง `nest build` เสมอ (ดู wipe:accounting / seed:coa ใน package.json)
 *
 * ที่นี่เลือกต่อเองเพราะอยาก "รันทีเดียวจบ" โดยไม่ต้อง build ก่อน — และได้ผลพลอยได้
 * คือไม่ลาก cron 20+ ตัว, BullMQ worker, LINE client ของ AppModule ขึ้นมาด้วย
 * (pattern เดียวกับ ecl-dry-run.cli.ts)
 */
function buildServices(prisma: PrismaClient) {
  // ConfigService ตัวจริงอ่านจาก process.env อยู่แล้ว — stub นี้ให้พฤติกรรมเดียวกัน
  // สำหรับ 2 ที่ที่ใช้จริงในเส้นทางนี้ (INTEGRATION_ENCRYPTION_KEY, ai budget config)
  const config = {
    get: <T = string>(key: string): T | undefined => process.env[key] as T | undefined,
  } as ConfigService;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const integrationConfig = new IntegrationConfigService(prisma as any, config);
  const history = new ChatHistoryExtractorService(
    prisma as any,
    new LineExtractorSource(prisma as any),
    new FacebookExtractorSource(integrationConfig),
  );
  const knowledge = new KnowledgeExtractorService(
    prisma as any,
    new AiUsageService(prisma as any, config),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { history, knowledge };
}

const MONTHS = Number(process.env.MONTHS ?? 12);
const SKIP_EXTRACT = process.env.SKIP_EXTRACT === '1' || process.env.SKIP_EXTRACT === 'true';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function line(char = '─') {
  console.log(char.repeat(66));
}

async function main() {
  if (!Number.isFinite(MONTHS) || MONTHS <= 0) {
    throw new Error(`MONTHS ต้องเป็นตัวเลขบวก (ได้: ${process.env.MONTHS})`);
  }
  // เช็ค API key ตั้งแต่ต้น — ไม่งั้นจะดูดแชททั้ง 12 เดือนเสร็จแล้วค่อยพังตอนขั้น 2
  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ไม่พบ ANTHROPIC_API_KEY — ขั้น 2 ต้องใช้เรียก Claude (หรือรันด้วย DRY_RUN=1)');
  }

  const prisma = new PrismaClient();
  const { history, knowledge } = buildServices(prisma);

  try {
    const [{ current_database: dbName }] = await prisma.$queryRaw<
      { current_database: string }[]
    >`SELECT current_database()`;
    const expected = process.env.EXPECTED_DB_NAME;
    if (expected && expected !== dbName) {
      throw new Error(`ต่อ DB ผิดตัว — EXPECTED_DB_NAME=${expected} แต่ต่ออยู่กับ ${dbName}`);
    }

    line('═');
    console.log('  เทรน AI ตอบลูกค้าจากประวัติแชทเก่า');
    line('═');
    console.log(`DB          : ${dbName}`);
    console.log(`ย้อนหลัง    : ${MONTHS} เดือน`);
    console.log(`โหมด        : ${DRY_RUN ? 'DRY RUN (ไม่เขียน ไม่เรียก Claude)' : 'เขียนจริง'}`);
    console.log('');

    if (DRY_RUN) {
      const since = new Date();
      since.setMonth(since.getMonth() - MONTHS);
      const [msgs, pairs, kb] = await Promise.all([
        prisma.chatMessage.count({ where: { createdAt: { gte: since }, deletedAt: null } }),
        prisma.aiTrainingPair.count({ where: { source: 'SYSTEM_EXTRACT' } }),
        prisma.chatKnowledgeBase.count({
          where: { category: { in: ['EXTRACTED', 'EXTRACTED_OBJECTION'] }, deletedAt: null },
        }),
      ]);
      console.log(
        `ข้อความในช่วง : ${msgs.toLocaleString()} ข้อความ (LINE — Facebook ต้องยิง API ถึงจะรู้)`,
      );
      console.log(`คู่ข้อความเดิม : ${pairs.toLocaleString()} คู่`);
      console.log(`แถวที่สกัดไว้  : ${kb.toLocaleString()} แถว`);
      console.log('\nไม่มีอะไรถูกเขียน — ตัด DRY_RUN ออกเพื่อรันจริง');
      return;
    }

    // ── ขั้น 1 ────────────────────────────────────────────────────────
    let pairsAvailable = await prisma.aiTrainingPair.count({ where: { source: 'SYSTEM_EXTRACT' } });

    if (SKIP_EXTRACT) {
      console.log(
        `[1/2] ข้าม (SKIP_EXTRACT=1) — ใช้คู่ข้อความเดิม ${pairsAvailable.toLocaleString()} คู่\n`,
      );
    } else {
      console.log(`[1/2] ดูดแชทย้อนหลัง ${MONTHS} เดือน…`);
      const extract = await history.extractAll(MONTHS);
      console.log(
        `      LINE ${extract.lineCount.toLocaleString()} · Facebook ${extract.fbCount.toLocaleString()} ` +
          `→ จับคู่ได้ ${extract.pairsWritten.toLocaleString()} คู่\n`,
      );
      pairsAvailable = await prisma.aiTrainingPair.count({ where: { source: 'SYSTEM_EXTRACT' } });
    }

    // หยุดก่อนถ้าไม่มีอะไรให้สกัด — กันเรียก Claude ทิ้งเปล่า ๆ
    if (pairsAvailable === 0) {
      console.log('ไม่มีคู่ข้อความใน ai_training_pairs — ไม่มีอะไรให้สกัด');
      console.log('สาเหตุที่พบบ่อย: DB นี้ยังไม่มีแชทจริง หรือช่วงเวลาที่เลือกไม่ครอบแชทที่มี');
      return;
    }

    // ── ขั้น 2 ────────────────────────────────────────────────────────
    console.log('[2/2] ให้ Claude สรุปเป็น FAQ + วิธีตอบข้อโต้แย้ง…');
    const seeded = await knowledge.extractAndSeed();
    console.log(
      `      FAQ ${seeded.faqsSeeded} แถว · ข้อโต้แย้ง ${seeded.objectionsSeeded} แถว ` +
        `(แถวใหม่ปิดไว้รอรีวิว — แถวที่เคยเปิดไว้แล้วยังเปิดอยู่เหมือนเดิม)\n`,
    );

    // ── สรุปสิ่งที่รอรีวิว ────────────────────────────────────────────
    const rows = await prisma.chatKnowledgeBase.findMany({
      where: { category: { in: ['EXTRACTED', 'EXTRACTED_OBJECTION'] }, deletedAt: null },
      orderBy: [{ category: 'asc' }, { priority: 'desc' }],
      select: {
        intent: true,
        category: true,
        channel: true,
        responseType: true,
        priority: true,
        active: true,
        responseTemplate: true,
      },
    });

    line();
    console.log(`รอรีวิวทั้งหมด ${rows.length} แถว`);
    line();
    for (const r of rows) {
      const mark = r.active ? '✓ เปิดแล้ว' : '· รอเปิด';
      const preview = r.responseTemplate.replace(/\s+/g, ' ').slice(0, 46);
      console.log(
        `${mark}  ${r.intent.padEnd(26)} ${(r.channel ?? 'ทุกช่อง').padEnd(13)} ` +
          `${r.responseType.padEnd(7)} p=${String(r.priority).padStart(3)}  ${preview}…`,
      );
    }
    line();
    console.log('ขั้นต่อไป: เปิดหน้า /chatbot-finance/knowledge → อ่าน → แก้ถ้อยคำ → ติ๊ก active');
    console.log('(ทุกแถวยังปิดอยู่ บอทจะยังไม่เอาไปใช้จนกว่าจะเปิดเอง)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  if (process.env.DEBUG && e instanceof Error) console.error(e.stack);
  process.exit(1);
});
