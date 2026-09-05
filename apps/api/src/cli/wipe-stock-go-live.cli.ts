/**
 * ล้างคลังก่อนเริ่มใช้จริง — spec docs/superpowers/specs/2026-09-05-stock-go-live-design.md §4
 * runbook: docs/accounting/stock-go-live-runbook-2026-09.md
 *
 * Dry-run (default):
 *   EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:stock-go-live
 * Live:
 *   CONFIRM_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *     [ALLOW_PROD_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE NODE_ENV=production] [ONLY_BRANCH_ID=<uuid>] \
 *     npm --prefix apps/api run wipe:stock-go-live
 *
 * - soft-delete ทั้งหมดด้วย timestamp เดียว (พิมพ์ rollback SQL ตอนจบ)
 * - plan + apply อยู่ใน Serializable tx เดียว — กันใบขายที่ commit ระหว่างสองขั้น
 * - ไม่แตะ GL / suppliers / reorder_points / trade_ins
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyWipe,
  formatPlan,
  planWipe,
  rollbackSql,
  STOCK_GO_LIVE_AUDIT_ACTION,
} from './stock-go-live/wipe-stock-go-live';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const TAG = '[wipe-stock-go-live]';

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: ต้องระบุ EXPECTED_DB_NAME=<ชื่อ DB> ให้ตรงกับ current_database()');
    console.error('กันรันผิดฐาน — ชื่อ DB จริงบน prod คือ "bestchoice"');
    process.exit(1);
  }
  const write = process.env.CONFIRM_WIPE_STOCK_GO_LIVE === REQUIRED_CONSENT;
  if (!write) {
    console.log(`${TAG} DRY-RUN mode (default). ล้างจริงให้รันซ้ำด้วย:`);
    console.log(
      `  CONFIRM_WIPE_STOCK_GO_LIVE=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> ` +
        `[ALLOW_PROD_WIPE_STOCK_GO_LIVE=${REQUIRED_CONSENT} NODE_ENV=production] ` +
        `[ONLY_BRANCH_ID=<uuid>] npm --prefix apps/api run wipe:stock-go-live`,
    );
    console.log('');
  }
  if (
    write &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PROD_WIPE_STOCK_GO_LIVE !== REQUIRED_CONSENT
  ) {
    console.error(
      `ERROR: NODE_ENV=production ต้องมี ALLOW_PROD_WIPE_STOCK_GO_LIVE=${REQUIRED_CONSENT} ด้วย`,
    );
    process.exit(1);
  }
  const branchId = process.env.ONLY_BRANCH_ID || undefined;

  const prisma = new PrismaClient();
  try {
    const [{ current_database: actualDb }] = await prisma.$queryRaw<
      { current_database: string }[]
    >`SELECT current_database()`;
    if (actualDb !== expectedDb) {
      console.error(`ERROR: ต่อ DB "${actualDb}" แต่ EXPECTED_DB_NAME="${expectedDb}" — ยกเลิก`);
      process.exit(1);
    }
    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: { name: true },
      });
      if (!branch) {
        console.error(`ERROR: ไม่พบสาขา ONLY_BRANCH_ID=${branchId}`);
        process.exit(1);
      }
      console.log(`${TAG} เฉพาะสาขา: ${branch.name}`);
    }
    // ผู้ทำรายการใน AuditLog — CLI ไม่มี actor จึงใช้ OWNER คนแรก (pattern resolveRefs ใน test-pack)
    const owner = await prisma.user.findFirst({
      where: { role: 'OWNER', deletedAt: null },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) {
      console.error('ERROR: ไม่มีผู้ใช้ role OWNER — AuditLog ต้องมี userId จริง');
      process.exit(1);
    }

    const wipedAt = new Date();
    console.log(`${TAG} DB: "${actualDb}" | ผู้ทำรายการ (audit): ${owner.email}`);
    console.log('');

    if (!write) {
      const plan = await planWipe(prisma, wipedAt, { branchId });
      for (const line of formatPlan(plan, 'DRY-RUN')) console.log(line);
      console.log('');
      console.log(`${TAG} DRY-RUN — ไม่ได้เขียนอะไรลง DB`);
      return;
    }

    const { plan, counts } = await prisma.$transaction(
      async (tx) => {
        const p = await planWipe(tx, wipedAt, { branchId });
        const c = await applyWipe(tx, p, owner.id);
        return { plan: p, counts: c };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 300_000,
        maxWait: 10_000,
      },
    );
    for (const line of formatPlan(plan, 'LIVE', counts)) console.log(line);
    console.log('');
    console.log(`${TAG} AuditLog: action=${STOCK_GO_LIVE_AUDIT_ACTION} entityId=${wipedAt.toISOString()}`);
    console.log(`${TAG} ย้อนกลับ (ถ้าจำเป็น) — รัน SQL ชุดนี้ผ่าน psql:`);
    for (const sql of rollbackSql(wipedAt)) console.log(`  ${sql}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`${TAG} FATAL:`, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
