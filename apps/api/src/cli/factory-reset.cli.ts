/**
 * Factory Reset CLI — ล้างข้อมูลทั้งหมด เก็บไว้เฉพาะนิติบุคคล/สาขา/ผู้ใช้
 *
 * ## ที่มา
 *
 * คำสั่งเจ้าของ 2026-08-25: ข้อมูลบน production ทั้งหมดที่ผ่านมาเป็น **การทดสอบโปรแกรม**
 * (ยืนยันกับผู้สอบบัญชีแล้ว — ดู `docs/accounting/cpa-answers-2026-08-24.md` คำตอบรอบ 2)
 * ก่อนเริ่มใช้งานจริงต้องการล้างให้เกลี้ยง เหลือเฉพาะข้อมูลตั้งต้นขององค์กร
 *
 * ## ทำไมถึงเป็น "ล้างทุกตารางแล้วเก็บรายการสั้น" ไม่ใช่ "ไล่ลบทีละตาราง"
 *
 * schema มี ~198 model — การไล่ระบุว่าตารางไหนต้องลบ แปลว่าความถูกต้องขึ้นกับการที่
 * คนเขียนไล่ครบทุกตาราง ซึ่ง **พิสูจน์ไม่ได้** และจะเพี้ยนทันทีที่มี model ใหม่
 *
 * สคริปต์นี้กลับด้าน: อ่านรายชื่อตารางจาก `information_schema` ตอนรัน แล้วล้าง
 * **ทุกตารางที่ไม่อยู่ใน KEEP_TABLES** ⇒
 *   - ตารางใหม่ที่เพิ่มวันหลังถูกล้างเองโดยอัตโนมัติ (พฤติกรรมที่ถูกต้อง)
 *   - รายการที่ต้องตรวจสอบด้วยตาเหลือแค่ไม่กี่บรรทัด
 *   - ตรวจผลได้ด้วยคำถามเดียว: "ทุกตารางเป็น 0 ยกเว้นที่ตั้งใจเก็บใช่ไหม"
 *
 * ## TRUNCATE ผ่าน trigger กันลบของ audit_logs ได้
 *
 * `audit_logs` และ `bad_debt_write_off_audit_logs` มี trigger กัน DELETE
 * (migration 20260520300000 / 20260519000000) แต่ทั้งคู่เป็น
 * **`BEFORE DELETE ... FOR EACH ROW`** และไม่มี statement-level trigger เลย
 * ⇒ PostgreSQL ไม่จุด row-level trigger ตอน TRUNCATE ⇒ ผ่านได้โดย **ไม่ต้อง drop trigger**
 * (การ drop แล้วลืมสร้างกลับ = เกราะกันแก้หลักฐานหายถาวร อันตรายกว่ามาก)
 *
 * ## หลังรันเสร็จต้องทำอะไรต่อ
 *
 * ดู `docs/accounting/factory-reset-runbook-2026-08.md` — โดยย่อ:
 *   1. `npm run seed:coa`            ← ผังบัญชี FINANCE + SHOP
 *   2. ตั้ง `Branch.shopCashAccountCode` ทุกสาขา (ไม่ตั้ง = ขายสดไม่ได้ fail-closed)
 *   3. ตั้ง `User.defaultCashAccountCode` ทุกคน
 *   4. ตั้งค่าดอกเบี้ย/ค่าคอม/งวดบัญชี
 *   5. รัน `docs/accounting/shop-books-preflight-2026-08.sql` ยืนยันว่าสะอาดจริง
 *
 * ## วิธีรัน
 *
 *   DRY_RUN=1 EXPECTED_DB_NAME=<db> npm --prefix apps/api run factory:reset   ← ดูก่อนว่าจะลบอะไร
 *
 *   CONFIRM_FACTORY_RESET=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *     [ALLOW_PROD_RESET=YES_I_AM_SURE] npm --prefix apps/api run factory:reset
 *
 * ⚠️ **ก่อนรันบน production ต้องยืนยันจุด PITR/backup ของ Cloud SQL ก่อนเสมอ**
 */
import { PrismaClient } from '@prisma/client';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

/**
 * ตารางที่ **เก็บไว้** — ทุกตารางนอกรายการนี้จะถูก TRUNCATE
 *
 * เจ้าของระบุ 2026-08-25: เก็บ "ข้อมูลนิติบุคคล + สาขา + ผู้ใช้"
 *
 * `_prisma_migrations` ต้องเก็บเสมอ ไม่งั้น `migrate deploy` จะพยายามรัน migration
 * ทั้งหมดซ้ำบน schema ที่มีตารางอยู่แล้ว = พังทันที
 */
const KEEP_TABLES = new Set<string>([
  '_prisma_migrations', // ประวัติ migration — ล้างแล้ว deploy ครั้งหน้าพัง
  'company_info', // นิติบุคคล (SHOP / FINANCE)
  'branches', // สาขา
  'users', // ผู้ใช้ระบบ
]);

/** ตารางที่ล้างแล้วต้อง seed กลับทันที ไม่งั้นระบบทำงานไม่ได้ — เตือนตอนจบ */
const RESEED_REQUIRED = ['chart_of_accounts'];

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

  if (!dryRun && process.env.CONFIRM_FACTORY_RESET !== REQUIRED_CONSENT) {
    console.error(`ERROR: ต้องมี CONFIRM_FACTORY_RESET=${REQUIRED_CONSENT} ถึงจะรันได้`);
    console.error('');
    console.error('สคริปต์นี้ TRUNCATE **ทุกตาราง** ยกเว้น:');
    for (const t of KEEP_TABLES) console.error(`  - ${t}`);
    console.error('');
    console.error('ข้อมูลสัญญา การชำระเงิน บัญชี ลูกค้า สินค้า ทั้งหมดจะหายถาวร');
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
    // อ่านรายชื่อตารางจริงตอนรัน — ไม่ hardcode เพื่อให้ตารางใหม่ถูกล้างเองอัตโนมัติ
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    const all = rows.map((r) => r.tablename);
    const toWipe = all.filter((t) => !KEEP_TABLES.has(t));
    const kept = all.filter((t) => KEEP_TABLES.has(t));

    // ตารางใน KEEP_TABLES ที่ไม่มีจริงใน DB = พิมพ์ผิด ⇒ หยุดก่อนลบอะไร
    const missingKeep = [...KEEP_TABLES].filter((t) => !all.includes(t));
    if (missingKeep.length > 0) {
      console.error(`ERROR: ตารางในรายการที่จะเก็บไม่มีอยู่จริงใน DB: ${missingKeep.join(', ')}`);
      console.error('อาจพิมพ์ชื่อผิด — ยกเลิกก่อนลบอะไรทั้งสิ้น');
      await prisma.$disconnect();
      process.exit(1);
    }

    // ── ด่านสำคัญที่สุด: CASCADE ต้องลามเข้ามาในชุดที่เก็บไม่ได้ ──────────────
    //
    // `TRUNCATE x CASCADE` จะล้าง **ทุกตารางที่มี FK ชี้มาที่ x** ด้วย ⇒ ถ้าตารางที่เรา
    // ตั้งใจเก็บดันมี FK ชี้ไปตารางที่จะล้าง มันจะถูกล้างไปด้วยอย่างเงียบ ๆ
    // = ลบผู้ใช้/สาขาทิ้งทั้งที่สั่งให้เก็บ
    //
    // ณ 2026-08-25 ชุดที่เก็บปิดตัวเอง (users → branches → company_info → จบ)
    // แต่ **ห้ามพึ่งการตรวจครั้งเดียว** — ถ้าวันหลังมีคนเพิ่ม FK เช่น
    // `User.employeeProfileId` ชุดจะเปิดทันทีโดยไม่มีใครรู้ จึงตรวจสดทุกครั้งที่รัน
    const outboundFks = await prisma.$queryRawUnsafe<
      Array<{ src: string; dst: string; constraint: string }>
    >(`
      SELECT tc.table_name AS src, ccu.table_name AS dst, tc.constraint_name AS constraint
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = ANY($1::text[])
        AND ccu.table_name <> ALL($1::text[])
    `, kept);
    if (outboundFks.length > 0) {
      console.error('ERROR: ตารางที่จะเก็บมี FK ชี้ไปตารางที่จะล้าง —');
      console.error('       TRUNCATE ... CASCADE จะลบตารางที่ตั้งใจเก็บไปด้วย');
      for (const fk of outboundFks) {
        console.error(`  ${fk.src} -> ${fk.dst}  (${fk.constraint})`);
      }
      console.error('');
      console.error('ต้องเพิ่มตารางปลายทางเข้า KEEP_TABLES หรือทบทวนแผนก่อน — ยกเลิก');
      await prisma.$disconnect();
      process.exit(1);
    }

    // นับแถวก่อนล้าง เพื่อให้เห็นว่ากำลังจะลบอะไรไปเท่าไร
    const counts: Array<{ table: string; rows: number }> = [];
    for (const t of toWipe) {
      const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "${t}"`,
      );
      const n = Number(count);
      if (n > 0) counts.push({ table: t, rows: n });
    }
    counts.sort((a, b) => b.rows - a.rows);

    console.log('');
    console.log(`ฐานข้อมูล : ${actualDb}`);
    console.log(`ตารางทั้งหมด : ${all.length}`);
    console.log(`เก็บไว้ : ${kept.length}  (${kept.join(', ')})`);
    console.log(`จะล้าง : ${toWipe.length} ตาราง · มีข้อมูลจริง ${counts.length} ตาราง`);
    console.log('');
    if (counts.length > 0) {
      console.log('ตารางที่มีข้อมูล (เรียงจากมากไปน้อย):');
      for (const c of counts.slice(0, 40)) {
        console.log(`  ${String(c.rows).padStart(8)}  ${c.table}`);
      }
      if (counts.length > 40) console.log(`  ... และอีก ${counts.length - 40} ตาราง`);
      console.log('');
      console.log(`  รวม ${counts.reduce((a, c) => a + c.rows, 0).toLocaleString()} แถว`);
    } else {
      console.log('ไม่มีตารางไหนมีข้อมูลเลย — ล้างไปก็ไม่มีอะไรเปลี่ยน');
    }
    console.log('');

    // แสดงจำนวนแถวที่เก็บไว้ ให้ยืนยันว่าไม่ได้เก็บของว่าง
    console.log('ข้อมูลที่จะเก็บไว้:');
    for (const t of kept) {
      const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "${t}"`,
      );
      console.log(`  ${String(Number(count)).padStart(8)}  ${t}`);
    }
    console.log('');

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

    // TRUNCATE ทุกตารางในคำสั่งเดียว — PostgreSQL จัดการลำดับ FK ให้เอง
    // เร็วกว่าและปลอดภัยกว่าการไล่ทีละตาราง (ไม่มีสถานะกลางที่ล้างไปครึ่งเดียว)
    // RESTART IDENTITY: รีเซ็ต sequence ให้เลขรันเริ่มใหม่จาก 1
    const quoted = toWipe.map((t) => `"${t}"`).join(', ');
    console.log('[factory-reset] กำลังล้าง...');
    await prisma.$executeRawUnsafe(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
    console.log(`[factory-reset] ล้าง ${toWipe.length} ตารางเรียบร้อย`);

    // ตรวจผล — ทุกตารางที่ล้างต้องเป็น 0
    const leftovers: string[] = [];
    for (const t of toWipe) {
      const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "${t}"`,
      );
      if (Number(count) > 0) leftovers.push(`${t}=${Number(count)}`);
    }
    if (leftovers.length > 0) {
      console.error(`ERROR: ยังมีข้อมูลเหลือหลังล้าง: ${leftovers.join(', ')}`);
      process.exit(1);
    }

    console.log('');
    console.log('ตรวจแล้ว: ทุกตารางที่ล้างเป็น 0 แถว');
    console.log('');
    console.log('*** ขั้นตอนถัดไป (จำเป็น) ***');
    console.log(`  1. npm --prefix apps/api run seed:coa   ← ${RESEED_REQUIRED.join(', ')} ว่างอยู่`);
    console.log('  2. ตั้ง Branch.shopCashAccountCode ทุกสาขา (ไม่ตั้ง = ขายสดไม่ได้)');
    console.log('  3. ตั้ง User.defaultCashAccountCode ทุกคน');
    console.log('  4. ตั้งค่าดอกเบี้ย / ค่าคอม / เปิดงวดบัญชี');
    console.log('  5. รัน docs/accounting/shop-books-preflight-2026-08.sql ยืนยัน');
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
