/**
 * Factory Reset CLI — ล้างเฉพาะข้อมูลที่สร้างขึ้นมาทดสอบ เก็บการตั้งค่าและทะเบียนหลักไว้
 *
 * ## ที่มา
 *
 * คำสั่งเจ้าของ 2026-08-25: ข้อมูลธุรกรรมบน production ทั้งหมดที่ผ่านมาเป็น **การทดสอบ
 * โปรแกรม** (ยืนยันกับผู้สอบบัญชีแล้ว — `docs/accounting/cpa-answers-2026-08-24.md`
 * คำตอบรอบ 2) ก่อนเริ่มใช้จริงต้องการล้างออก
 *
 * ขอบเขตถูกแก้ในวันเดียวกัน จาก "เก็บแค่นิติบุคคล+สาขา+ผู้ใช้" เป็น:
 *
 *   > "อันนี้ยังไม่ต้องล้าง สาขา → ตั้งบัญชีผู้ใช้ → ตั้งดอกเบี้ย/ค่าคอม/งวด
 *   >  และก็ประวัติแชท ล้างเฉพาะข้อมูลที่สร้างขึ้นมาเทสเท่านั้น"
 *
 * บวกกับที่ยืนยันเพิ่ม: **เก็บทะเบียนลูกค้าและสินค้าทั้งหมด**
 *
 * ## ทำไมต้องจำแนกครบสองทาง (KEEP + WIPE) แทน "ที่เหลือล้างหมด"
 *
 * เหตุผลเต็มอยู่ใน `factory-reset-tables.ts` โดยย่อ: รายการที่เก็บโตเป็น ~70 ตาราง และ
 * ในนั้นมี 11 ตารางที่ seed อยู่ใน migration เท่านั้น **สร้างกลับไม่ได้** ⇒ ผลของการ
 * "ลืมจำแนก" พลิกจากปลอดภัยเป็นสูญหายถาวร สคริปต์จึง **หยุด** เมื่อเจอตารางที่ไม่อยู่
 * ในลิสต์ไหนเลย แทนที่จะเดา
 *
 * ## TRUNCATE ผ่าน trigger กันลบของ audit_logs ได้
 *
 * `audit_logs` / `bad_debt_write_off_audit_logs` มี trigger กัน DELETE
 * (migration 20260520300000 / 20260519000000) แต่ทั้งคู่เป็น
 * **`BEFORE DELETE ... FOR EACH ROW`** และไม่มี statement-level trigger เลย
 * ⇒ PostgreSQL ไม่จุด row-level trigger ตอน TRUNCATE ⇒ ผ่านได้โดย **ไม่ต้อง drop trigger**
 * (drop แล้วลืมสร้างกลับ = เกราะกันแก้หลักฐานหายถาวร อันตรายกว่ามาก)
 *
 * ## วิธีรัน
 *
 *   DRY_RUN=1 EXPECTED_DB_NAME=<db> npm --prefix apps/api run factory:reset
 *
 *   CONFIRM_FACTORY_RESET=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *     [ALLOW_PROD_RESET=YES_I_AM_SURE] npm --prefix apps/api run factory:reset
 *
 * ⚠️ **ก่อนรันบน production ต้องยืนยันจุด PITR/backup ของ Cloud SQL ก่อนเสมอ**
 */
import { PrismaClient } from '@prisma/client';
import {
  KEEP_TABLES,
  WIPE_TABLES,
  PRE_TRUNCATE_NULLIFY,
  PRODUCT_STATUS_RESTORE,
  PRODUCT_STATUS_REPORT_ONLY,
} from './factory-reset-tables';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function countRows(prisma: PrismaClient, table: string): Promise<number> {
  const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
  );
  return Number(count);
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

  if (!dryRun && process.env.CONFIRM_FACTORY_RESET !== REQUIRED_CONSENT) {
    console.error(`ERROR: ต้องมี CONFIRM_FACTORY_RESET=${REQUIRED_CONSENT} ถึงจะรันได้`);
    console.error('');
    console.error(`สคริปต์นี้ TRUNCATE ${WIPE_TABLES.size} ตาราง (สัญญา ใบขาย ใบเสร็จ`);
    console.error('รายการบัญชี ค่าคอม ใบเบิกจ่าย log ทั้งหมด) — หายถาวร');
    console.error(`เก็บไว้ ${KEEP_TABLES.size} ตาราง: ตั้งค่า เทมเพลต ลูกค้า สินค้า แชท`);
    console.error('');
    console.error('ก่อนรันบน production ต้องยืนยันจุด PITR/backup ของ Cloud SQL ก่อน');
    console.error('');
    console.error('ลองดูก่อนว่าจะลบอะไร (ไม่เขียนอะไรเลย):');
    console.error('  DRY_RUN=1 EXPECTED_DB_NAME=<db> npm --prefix apps/api run factory:reset');
    process.exit(1);
  }

  if (
    !dryRun &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PROD_RESET !== REQUIRED_CONSENT
  ) {
    console.error(`ERROR: NODE_ENV=production ต้องมี ALLOW_PROD_RESET=${REQUIRED_CONSENT} ด้วย`);
    process.exit(1);
  }

  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: ต้องระบุ EXPECTED_DB_NAME=<ชื่อ DB> ให้ตรงกับ current_database()');
    console.error('กันรันผิดฐาน — ชื่อ DB จริงบน prod คือ "bestchoice"');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const [{ current_database: actualDb }] = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: ต่อ DB "${actualDb}" แต่ EXPECTED_DB_NAME="${expectedDb}" — ยกเลิก`);
    await prisma.$disconnect();
    process.exit(1);
  }

  try {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    const all = rows.map((r) => r.tablename);

    // ── ด่าน 1: ทุกตารางใน DB ต้องถูกจำแนกแล้ว ────────────────────────────
    // model ใหม่ที่เพิ่มหลังเขียนไฟล์นี้จะมาโผล่ตรงนี้ ⇒ บังคับให้มีคนตัดสินใจ
    // ว่า "เก็บ" หรือ "ล้าง" แทนที่จะเดาแล้วล้างของที่กู้ไม่ได้ทิ้ง
    const unclassified = all.filter((t) => !KEEP_TABLES.has(t) && !WIPE_TABLES.has(t));
    if (unclassified.length > 0) {
      console.error('ERROR: มีตารางที่ยังไม่ได้จำแนกว่าเก็บหรือล้าง:');
      for (const t of unclassified) console.error(`  - ${t}`);
      console.error('');
      console.error('เพิ่มเข้า KEEP_TABLES หรือ WIPE_TABLES ใน');
      console.error('  apps/api/src/cli/factory-reset-tables.ts');
      console.error('แล้วรันใหม่ — ยกเลิกก่อนลบอะไรทั้งสิ้น');
      await prisma.$disconnect();
      process.exit(1);
    }

    // ── ด่าน 2: ชื่อในลิสต์ต้องมีจริง (กันพิมพ์ผิด) ──────────────────────────
    const ghosts = [...KEEP_TABLES, ...WIPE_TABLES].filter((t) => !all.includes(t));
    if (ghosts.length > 0) {
      console.error(`ERROR: ตารางในลิสต์ไม่มีอยู่จริงใน DB: ${ghosts.join(', ')}`);
      console.error('อาจพิมพ์ชื่อผิด — ยกเลิกก่อนลบอะไรทั้งสิ้น');
      await prisma.$disconnect();
      process.exit(1);
    }

    const toWipe = all.filter((t) => WIPE_TABLES.has(t));
    const kept = all.filter((t) => KEEP_TABLES.has(t));

    // ── ด่าน 3 (สำคัญที่สุด): CASCADE ต้องลามเข้ามาในชุดที่เก็บไม่ได้ ────────
    //
    // `TRUNCATE x CASCADE` ล้าง **ทุกตารางที่มี FK ชี้มาที่ x** ด้วย ⇒ ตารางที่ตั้งใจ
    // เก็บแต่มี FK ชี้ไปตารางที่จะล้าง จะถูกล้างไปด้วยอย่างเงียบ ๆ
    //
    // ด่านนี้จับของจริงมาแล้ว 4 เคสตอนออกแบบ — เคสร้ายที่สุดคือ
    // `chat_rooms → ads_attributions` ซึ่งจะพา `chat_messages` (onDelete: Cascade)
    // หายไปทั้งหมด = ประวัติแชทที่เจ้าของสั่งให้เก็บหายเกลี้ยง
    // (แก้ด้วย PRE_TRUNCATE_NULLIFY ด้านล่าง)
    //
    // ตรวจ **สดทุกครั้งที่รัน** ไม่พึ่งการตรวจครั้งเดียว — FK ใหม่ที่เพิ่มวันหลัง
    // จะเปิดช่องนี้ทันทีโดยไม่มีใครรู้
    const nullified = new Set(PRE_TRUNCATE_NULLIFY.map((n) => `${n.table}.${n.column}`));
    const outboundFks = await prisma.$queryRawUnsafe<
      Array<{ src: string; col: string; dst: string; constraint: string }>
    >(
      `
      SELECT tc.table_name AS src, kcu.column_name AS col,
             ccu.table_name AS dst, tc.constraint_name AS constraint
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = ANY($1::text[])
        AND ccu.table_name <> ALL($1::text[])
    `,
      kept,
    );
    const unhandled = outboundFks.filter((fk) => !nullified.has(`${fk.src}.${fk.col}`));
    if (unhandled.length > 0) {
      console.error('ERROR: ตารางที่จะเก็บมี FK ชี้ไปตารางที่จะล้าง —');
      console.error('       TRUNCATE ... CASCADE จะลบตารางที่ตั้งใจเก็บไปด้วย');
      for (const fk of unhandled) {
        console.error(`  ${fk.src}.${fk.col} -> ${fk.dst}  (${fk.constraint})`);
      }
      console.error('');
      console.error('ทางเลือก: ย้ายปลายทางเข้า KEEP_TABLES หรือ (ถ้าคอลัมน์ nullable)');
      console.error('เพิ่มเข้า PRE_TRUNCATE_NULLIFY — ยกเลิก');
      await prisma.$disconnect();
      process.exit(1);
    }

    const counts: Array<{ table: string; rows: number }> = [];
    for (const t of toWipe) {
      const n = await countRows(prisma, t);
      if (n > 0) counts.push({ table: t, rows: n });
    }
    counts.sort((a, b) => b.rows - a.rows);

    console.log('');
    console.log(`ฐานข้อมูล    : ${actualDb}`);
    console.log(`ตารางทั้งหมด : ${all.length}  (เก็บ ${kept.length} · ล้าง ${toWipe.length})`);
    console.log('');
    console.log(`จะล้าง : ${toWipe.length} ตาราง · มีข้อมูลจริง ${counts.length} ตาราง`);
    if (counts.length > 0) {
      for (const c of counts.slice(0, 40)) {
        console.log(`  ${String(c.rows).padStart(8)}  ${c.table}`);
      }
      if (counts.length > 40) console.log(`  ... และอีก ${counts.length - 40} ตาราง`);
      console.log(`  รวม ${counts.reduce((a, c) => a + c.rows, 0).toLocaleString()} แถว`);
    } else {
      console.log('  (ไม่มีตารางไหนมีข้อมูลเลย)');
    }
    console.log('');

    const keptCounts: Array<{ table: string; rows: number }> = [];
    for (const t of kept) keptCounts.push({ table: t, rows: await countRows(prisma, t) });
    keptCounts.sort((a, b) => b.rows - a.rows);
    console.log(`เก็บไว้ : ${kept.length} ตาราง (แสดงเฉพาะที่มีข้อมูล)`);
    for (const c of keptCounts.filter((x) => x.rows > 0)) {
      console.log(`  ${String(c.rows).padStart(8)}  ${c.table}`);
    }
    console.log('');

    // สถานะสินค้าที่จะค้างเพราะใบขาย/สัญญาถูกล้าง
    const stuck = await prisma.$queryRawUnsafe<Array<{ status: string; count: bigint }>>(
      `SELECT status::text AS status, COUNT(*)::bigint AS count FROM "products"
       WHERE status::text = ANY($1::text[]) AND deleted_at IS NULL GROUP BY status ORDER BY 1`,
      [...PRODUCT_STATUS_RESTORE, ...PRODUCT_STATUS_REPORT_ONLY],
    );
    if (stuck.length > 0) {
      console.log('สถานะสินค้าที่ค้างเพราะใบขาย/สัญญาถูกล้าง:');
      for (const s of stuck) {
        const act = PRODUCT_STATUS_RESTORE.includes(s.status)
          ? '→ คืนเป็น IN_STOCK อัตโนมัติ'
          : '→ ไม่แตะ (ต้องตีราคาใหม่ก่อนขาย — ทำเองที่หน้าจอ)';
        console.log(`  ${String(Number(s.count)).padStart(8)}  ${s.status.padEnd(18)} ${act}`);
      }
      console.log('');
    }

    if (dryRun) {
      console.log('DRY_RUN — ไม่ได้เขียนอะไรลง DB');
      console.log('รันจริงด้วย: CONFIRM_FACTORY_RESET=YES_I_AM_SURE EXPECTED_DB_NAME=<db> ...');
      await prisma.$disconnect();
      return;
    }

    console.error('');
    console.error(`*** กำลังจะ TRUNCATE ${toWipe.length} ตารางบน "${actualDb}" ***`);
    console.error('กด Ctrl+C ภายใน 10 วินาทีเพื่อยกเลิก');
    await new Promise((r) => setTimeout(r, 10_000));

    // ① ตัดสาย FK ที่จะทำให้ CASCADE ลามเข้าชุดที่เก็บ (ต้องทำ **ก่อน** TRUNCATE)
    for (const n of PRE_TRUNCATE_NULLIFY) {
      const affected = await prisma.$executeRawUnsafe(
        `UPDATE "${n.table}" SET "${n.column}" = NULL WHERE "${n.column}" IS NOT NULL`,
      );
      console.log(`[factory-reset] NULL ${n.table}.${n.column} — ${affected} แถว (${n.why})`);
    }

    // ② TRUNCATE ทุกตารางในคำสั่งเดียว — PostgreSQL จัดลำดับ FK ให้เอง
    //    ไม่มีสถานะกลางที่ล้างไปครึ่งเดียว · RESTART IDENTITY รีเซ็ต sequence
    const quoted = toWipe.map((t) => `"${t}"`).join(', ');
    console.log('[factory-reset] กำลังล้าง...');
    await prisma.$executeRawUnsafe(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
    console.log(`[factory-reset] ล้าง ${toWipe.length} ตารางเรียบร้อย`);

    // ③ คืนสถานะสินค้า + กรรมสิทธิ์กลับ SHOP
    //    เหตุผลว่าทำไมคืนแค่ 3 สถานะ ดู PRODUCT_STATUS_RESTORE ใน factory-reset-tables.ts
    const restored = await prisma.$executeRawUnsafe(
      `UPDATE "products" SET status = 'IN_STOCK'
       WHERE status::text = ANY($1::text[]) AND deleted_at IS NULL`,
      PRODUCT_STATUS_RESTORE as string[],
    );
    console.log(`[factory-reset] คืนสถานะสินค้าเป็น IN_STOCK — ${restored} เครื่อง`);

    // กรรมสิทธิ์ย้ายไป FINANCE ตอนเปิดสัญญาผ่อน — สัญญาถูกล้างแล้ว ต้องคืนให้ SHOP
    const shop = await prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP' },
      select: { id: true },
    });
    if (shop) {
      const reowned = await prisma.$executeRawUnsafe(
        `UPDATE "products" SET owned_by_company_id = $1
         WHERE owned_by_company_id IS DISTINCT FROM $1 AND deleted_at IS NULL`,
        shop.id,
      );
      console.log(`[factory-reset] คืนกรรมสิทธิ์สินค้าให้ SHOP — ${reowned} เครื่อง`);
    } else {
      console.warn('[factory-reset] ⚠️ ไม่พบ CompanyInfo companyCode=SHOP — ข้ามการคืนกรรมสิทธิ์');
    }

    // ④ ตรวจผล — ทุกตารางที่ล้างต้องเป็น 0
    const leftovers: string[] = [];
    for (const t of toWipe) {
      const n = await countRows(prisma, t);
      if (n > 0) leftovers.push(`${t}=${n}`);
    }
    if (leftovers.length > 0) {
      console.error(`ERROR: ยังมีข้อมูลเหลือหลังล้าง: ${leftovers.join(', ')}`);
      process.exit(1);
    }

    // ⑤ ตรวจว่าของที่สั่งให้เก็บยังอยู่ครบ (กัน CASCADE เล็ดลอด)
    const vanished: string[] = [];
    for (const c of keptCounts) {
      if (c.rows > 0 && (await countRows(prisma, c.table)) === 0) vanished.push(c.table);
    }
    if (vanished.length > 0) {
      console.error(`ERROR: ตารางที่สั่งให้เก็บกลับว่างหลังล้าง: ${vanished.join(', ')}`);
      console.error('CASCADE เล็ดลอด — ต้องกู้จาก PITR ทันที');
      process.exit(1);
    }

    console.log('');
    console.log('ตรวจแล้ว: ทุกตารางที่ล้างเป็น 0 · ทุกตารางที่เก็บยังมีข้อมูลครบ');
    console.log('');
    console.log('*** ขั้นตอนถัดไป ***');
    console.log('  1. ตรวจสถานะสินค้าที่ไม่ได้คืนอัตโนมัติ (REPOSSESSED/REFURBISHED/SOLD_RESELL)');
    console.log('  2. ตั้งยอดยกมา: สินค้าคงเหลือยังอยู่แต่ไม่มีรายการบัญชีรองรับแล้ว');
    console.log('  3. เปิดงวดบัญชีของเดือนที่จะเริ่มใช้จริง');
    console.log('  4. รัน docs/accounting/shop-books-preflight-2026-08.sql ยืนยัน');
    console.log('');
    console.log('ดูรายละเอียด: docs/accounting/factory-reset-runbook-2026-08.md');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[factory-reset] ล้มเหลว:', e);
  process.exit(1);
});
