/**
 * ล้างข้อมูล inbox ครั้งเดียวก่อนวันแรกที่ทีมย้ายมาใช้
 * สเปก docs/superpowers/specs/2026-09-05-inbox-day-one-readiness-design.md §6
 *
 * ทำ 3 ขั้นใน transaction เดียว (รันซ้ำได้ ผลเป็น 0 การเปลี่ยนแปลง):
 *   1. assigned_to_id = NULL ทุกห้อง — ผู้ดูแลเดิมมาจาก autoAssign แบบวน ไม่มีใครเคยตอบจริง
 *   2. unread_count = 0 ในห้องที่ข้อความสุดท้ายไม่ใช่ของลูกค้า
 *   3. ห้องที่ข้อความสุดท้ายเป็นของลูกค้าและ last_message_at ไม่เกิน 7 วัน:
 *      waiting_since = ข้อความลูกค้าใบแรกหลังคำตอบล่าสุด · status = ACTIVE · resolved_at = NULL
 *      (เกิน 7 วัน = ตอบไม่ได้แล้วไม่ว่าทางไหน ปล่อย IDLE ตามเดิม)
 *
 * ⚠️ ต้องรันทันทีหลัง deploy PR1 และก่อนทีมเริ่มตอบจาก inbox — ขั้น 1 ล้างผู้ดูแลทุกห้อง
 *
 * Dry-run เป็นค่าเริ่มต้น (พิมพ์ตัวเลข ไม่เขียน):
 *   EXPECTED_DB_NAME=<db> npm --prefix apps/api run reset:inbox-day-one
 * รันจริง:
 *   CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production] \
 *     npm --prefix apps/api run reset:inbox-day-one
 * บน prod ใช้กลไก Cloud Run Job เดียวกับ backfill-contacts (ดู header ของ backfill-contacts.cli.ts)
 * แล้ว override command เป็น `node dist/src/cli/reset-inbox-day-one.cli.js`
 */
import { PrismaClient, Prisma } from '@prisma/client';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const REACHABLE_DAYS = 7;
const HUMAN_OR_BOT = new Set(['STAFF', 'BOT']);

/**
 * เวลาที่ลูกค้าเริ่มรอ = ข้อความ CUSTOMER ใบแรกที่อยู่หลังคำตอบ (STAFF/BOT) ใบล่าสุด
 * คืน null เมื่อข้อความสุดท้ายไม่ใช่ของลูกค้า (= ไม่ได้รอ) · SYSTEM/AUTO_TRIGGER ไม่นับเป็นคำตอบ
 * `msgs` ต้องเรียง createdAt จากเก่าไปใหม่
 */
export function computeWaitingSince(msgs: { role: string; createdAt: Date }[]): Date | null {
  if (msgs.length === 0) return null;
  const lastCustomerOrReply = [...msgs].reverse().find((m) => m.role === 'CUSTOMER' || HUMAN_OR_BOT.has(m.role));
  if (!lastCustomerOrReply || lastCustomerOrReply.role !== 'CUSTOMER') return null;
  let lastReplyIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (HUMAN_OR_BOT.has(msgs[i].role)) { lastReplyIdx = i; break; }
  }
  const firstUnanswered = msgs.slice(lastReplyIdx + 1).find((m) => m.role === 'CUSTOMER');
  return firstUnanswered ? firstUnanswered.createdAt : null;
}

// ─── runnable glue (require.main === module) ─────────────────────────────────

/** ห้องที่ข้อความสุดท้าย (ไม่ลบ) เป็นของลูกค้า — ใช้ทั้งนับและเลือกผู้สมัครขั้น 3 */
const LAST_IS_CUSTOMER = Prisma.sql`
  COALESCE((SELECT m.role::text FROM chat_messages m
            WHERE m.room_id = r.id AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC LIMIT 1), '') = 'CUSTOMER'`;

async function count(prisma: PrismaClient, sql: Prisma.Sql): Promise<number> {
  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>(sql);
  return Number(n);
}

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME=<db> required');
    process.exit(1);
  }
  const dryRun = process.env.CONFIRM_BACKFILL !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[reset-inbox-day-one] DRY-RUN (ค่าเริ่มต้น) — พิมพ์ตัวเลข ไม่เขียน');
    console.log(`  รันจริง: CONFIRM_BACKFILL=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}] npm --prefix apps/api run reset:inbox-day-one`);
  }
  if (!dryRun && process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
    console.error(`ERROR: production ต้องมี ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}"`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`[reset-inbox-day-one] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  const cutoff = new Date(Date.now() - REACHABLE_DAYS * 24 * 3600 * 1000);

  try {
    const assigned = await count(prisma, Prisma.sql`
      SELECT count(*)::bigint AS n FROM chat_rooms r WHERE r.deleted_at IS NULL AND r.assigned_to_id IS NOT NULL`);
    const unreadStale = await count(prisma, Prisma.sql`
      SELECT count(*)::bigint AS n FROM chat_rooms r WHERE r.deleted_at IS NULL AND r.unread_count > 0 AND NOT (${LAST_IS_CUSTOMER})`);
    const candidates = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT r.id FROM chat_rooms r
      WHERE r.deleted_at IS NULL AND r.waiting_since IS NULL
        AND r.last_message_at > ${cutoff} AND (${LAST_IS_CUSTOMER})`);
    const unreachable = await count(prisma, Prisma.sql`
      SELECT count(*)::bigint AS n FROM chat_rooms r
      WHERE r.deleted_at IS NULL AND r.last_message_at <= ${cutoff} AND (${LAST_IS_CUSTOMER})`);

    console.log('[reset-inbox-day-one] ===== แผน =====');
    console.log(`  1. ล้างผู้ดูแล                     : ${assigned} ห้อง`);
    console.log(`  2. unread_count → 0                : ${unreadStale} ห้อง`);
    console.log(`  3. ตั้ง waiting_since + ACTIVE     : ${candidates.length} ห้อง (รอไม่เกิน ${REACHABLE_DAYS} วัน)`);
    console.log(`  4. ปล่อย IDLE (รอเกิน ${REACHABLE_DAYS} วัน)   : ${unreachable} ห้อง`);

    if (dryRun) return;

    console.log('[reset-inbox-day-one] Ctrl+C ภายใน 5 วินาทีเพื่อยกเลิก');
    await new Promise((r) => setTimeout(r, 5000));

    // waiting_since ต่อห้อง — ระดับสิบห้อง วนทีละห้องได้ (ไม่ต้อง SQL ซับซ้อน)
    const waitingPlan: { id: string; waitingSince: Date }[] = [];
    for (const c of candidates) {
      const msgs = await prisma.chatMessage.findMany({
        where: { roomId: c.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { role: true, createdAt: true },
      });
      const ws = computeWaitingSince(msgs);
      if (ws) waitingPlan.push({ id: c.id, waitingSince: ws });
    }

    const result = await prisma.$transaction(async (tx) => {
      const step1 = await tx.chatRoom.updateMany({
        where: { deletedAt: null, assignedToId: { not: null } },
        data: { assignedToId: null },
      });
      const step2 = await tx.$executeRaw(Prisma.sql`
        UPDATE chat_rooms r SET unread_count = 0
        WHERE r.deleted_at IS NULL AND r.unread_count > 0 AND NOT (${LAST_IS_CUSTOMER})`);
      let step3 = 0;
      for (const w of waitingPlan) {
        const res = await tx.chatRoom.updateMany({
          where: { id: w.id, waitingSince: null },
          data: { waitingSince: w.waitingSince, status: 'ACTIVE', resolvedAt: null },
        });
        step3 += res.count;
      }
      return { step1: step1.count, step2, step3 };
    });

    console.log('[reset-inbox-day-one] ===== ผล =====');
    console.log(`  1. ล้างผู้ดูแล                     : ${result.step1}`);
    console.log(`  2. unread_count → 0                : ${result.step2}`);
    console.log(`  3. ตั้ง waiting_since + ACTIVE     : ${result.step3}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[reset-inbox-day-one] FAILED', err);
    process.exit(1);
  });
}
