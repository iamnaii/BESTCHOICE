/**
 * ย้อนหลัง "ผู้สนใจอัตโนมัติจากแชท" ให้ห้องแชทเดิมที่ยังไม่มีเจ้าของ
 * (docs/superpowers/specs/2026-09-13-chat-prospects-design.md §3.5)
 *
 * ทำงานผ่าน ChatProspectService.ensureForRoom ตัวเดียวกับ runtime — ไม่มีสำเนาตรรกะที่สอง:
 * ห้องเรียงตาม created_at จากเก่าไปใหม่ ⇒ ห้องแรกของคนหนึ่งสร้างแถว (createdAt = วันทักครั้งแรก)
 * ห้องถัดไปของคนเดียวกันเจอ sibling ที่ผูกแล้ว ⇒ ใช้คนเดิม · รันซ้ำได้ (ห้องที่ผูกแล้วถูกข้ามตั้งแต่ query)
 *
 * KEYSET PAGINATION (Ruling R20 — amends R7) — วน chatRoom.findMany ด้วย explicit keyset
 * เดินหน้าเสมอ (orderBy createdAt,id + WHERE (createdAt,id) > (last.createdAt,last.id))
 * แทน Prisma `cursor`/`skip`: R7's เดิม `cursor:{id:lastId},skip:1` มีบั๊ก — ensureForRoom
 * เซ็ต customerId ให้ห้อง cursor เมื่อสำเร็จ ⇒ ห้องนั้นหลุดจาก BACKFILL_WHERE (customerId:null)
 * ก่อนหน้า query ถัดไปจะรัน ⇒ cursor row ไม่อยู่ในเซตที่ถูกกรองอีกต่อไป ⇒ `skip:1` (ซึ่งเป็น SQL
 * OFFSET หลังกรอง) ไปกิน "ห้องถัดไปที่ยังไม่ได้ประมวลผล" แทนแถว cursor ที่หายไปแล้ว — ห้องนั้นหลุด
 * จากทุก batch ไปตลอดกาลแบบเงียบๆ (พิสูจน์แล้ว: 3 ห้อง r1<r2<r3, batchSize=1, ทั้งหมด linkable ⇒
 * r2 หายไป). Keyset ไม่มีปัญหานี้เพราะเงื่อนไข ">last" ไม่สน ว่าห้อง last ยังอยู่ใน BACKFILL_WHERE
 * หรือไม่ — เป็นตัวเปรียบเทียบ (createdAt,id) ล้วนๆ ห้องที่ล้ม/ข้าม/สำเร็จในชุดหนึ่งยังขยับคีย์
 * ผ่านมันไปเสมอ กันวนซ้ำชุดเดิมไม่รู้จบเมื่อมีห้องล้มเหลวค้างอยู่หัวตาราง ≥ batchSize ห้องติดกัน
 *
 * plan.rooms vs result.processed — main() เทียบสองค่านี้หลังรันจริง และเตือน + exit 2 เมื่อต่างกัน
 * (สัญญาณสุขภาพของ pagination เอง ไม่ใช่การพิสูจน์ — ห้องใหม่อาจเข้ามาระหว่าง plan กับ run ได้จริง)
 *
 * ห้อง WEB ไม่นับเป็นผู้สนใจจนกว่าจะมีข้อความจากลูกค้าจริง (Ruling R3) — planBackfill/runBackfill
 * กันห้อง channel=WEB ที่ยังไม่มีข้อความ role=CUSTOMER แม้แต่ข้อความเดียว
 *
 * GUARDS (แบบเดียวกับ backfill-payment-receipts.cli.ts)
 * - EXPECTED_DB_NAME ต้องตรง current_database() ไม่งั้น exit 1
 * - DRY-RUN เป็นค่าตั้งต้น: พิมพ์แผน ไม่เขียนอะไร
 * - CONFIRM_BACKFILL=YES_I_AM_SURE จึงเขียน · NODE_ENV=production ต้องมี ALLOW_PROD_BACKFILL=YES_I_AM_SURE ด้วย
 *
 * ใช้:  EXPECTED_DB_NAME=bestchoice_prod npm --prefix apps/api run backfill:chat-prospects            (dry-run)
 *       CONFIRM_BACKFILL=YES_I_AM_SURE ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production \
 *       EXPECTED_DB_NAME=bestchoice_prod npm --prefix apps/api run backfill:chat-prospects            (เขียนจริง)
 *       BATCH_SIZE=500 ปรับได้ · dev: DATABASE_URL=… npx ts-node --transpile-only src/cli/backfill-chat-prospects.cli.ts
 *
 * รันจริงบน prod เป็น Cloud Run Job แยกต่างหาก (นอกขอบเขตงานนี้)
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatProspectService } from '../modules/chat-prospects/chat-prospect.service';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const ROOM_SELECT = { id: true, channel: true, lineUserId: true, externalUserId: true, displayName: true, createdAt: true } as const;

/**
 * ห้องที่ยังไม่มีเจ้าของ ยกเว้นห้อง WEB (widget) ที่ยังไม่มีข้อความจากลูกค้าเลย (Ruling R3) —
 * เปิดหน้าเว็บเฉยๆ ไม่ใช่ "ทักเข้ามา"; ใช้ร่วมกันทั้ง planBackfill และ runBackfill
 */
export const BACKFILL_WHERE: Prisma.ChatRoomWhereInput = {
  deletedAt: null,
  customerId: null,
  OR: [{ channel: { not: 'WEB' } }, { channel: 'WEB', messages: { some: { role: 'CUSTOMER' } } }],
};

type Db = Pick<PrismaClient, 'chatRoom' | 'customer' | 'customerLineLink'>;
type Room = { id: string; channel: string; lineUserId: string | null; externalUserId: string | null; displayName: string | null; createdAt: Date };

export interface BackfillPlan { rooms: number; persons: number; personsWithExistingCustomer: number; roomsWithoutName: number; byChannel: Record<string, number> }
export interface BackfillResult { processed: number; created: number; linkedExisting: number; skipped: number; failed: number }

const personKey = (r: Room) => `${r.channel}:${r.lineUserId ?? r.externalUserId ?? ''}`;

/** แผน (dry-run): ห้องที่ยังไม่มีเจ้าของ จัดกลุ่มเป็น "คน" และนับคนที่มีลูกค้าเดิมอยู่แล้วทาง LINE */
export async function planBackfill(prisma: Db): Promise<BackfillPlan> {
  const rooms = (await prisma.chatRoom.findMany({
    where: BACKFILL_WHERE,
    select: ROOM_SELECT,
    orderBy: { createdAt: 'asc' },
  })) as Room[];
  const persons = new Map<string, Room>();
  const byChannel: Record<string, number> = {};
  let roomsWithoutName = 0;
  for (const room of rooms) {
    byChannel[room.channel] = (byChannel[room.channel] ?? 0) + 1;
    if (!room.displayName?.trim()) roomsWithoutName++;
    if (!persons.has(personKey(room))) persons.set(personKey(room), room);
  }
  let personsWithExistingCustomer = 0;
  for (const room of persons.values()) {
    if (!room.lineUserId) continue;
    const linkChannel = room.channel === 'LINE_SHOP' ? 'SHOP' : 'FINANCE';
    const link = await prisma.customerLineLink.findUnique({
      where: { lineUserId_channel: { lineUserId: room.lineUserId, channel: linkChannel } },
      select: { customerId: true },
    });
    const byColumn = link
      ? null
      : await prisma.customer.findFirst({
          where: { ...(room.channel === 'LINE_SHOP' ? { lineIdShop: room.lineUserId } : { lineIdFinance: room.lineUserId }), deletedAt: null },
          select: { id: true },
        });
    if (link || byColumn) personsWithExistingCustomer++;
  }
  return { rooms: rooms.length, persons: persons.size, personsWithExistingCustomer, roomsWithoutName, byChannel };
}

/**
 * เขียนจริง: วนห้องที่ยังไม่มีเจ้าของด้วย explicit keyset เดินหน้าเสมอ (Ruling R20) — ไม่ใช้
 * Prisma cursor/skip (บั๊ก — ดู docblock บนไฟล์) และไม่ re-query หัวตารางซ้ำ เพราะห้องที่ล้ม/ข้าม
 * ยังค้างอยู่หัว query เดิมได้ (จะวนไม่รู้จบถ้ามีห้องล้มเหลวติดกัน ≥ batchSize ห้อง)
 */
export async function runBackfill(
  prisma: Pick<PrismaClient, 'chatRoom'>,
  service: Pick<ChatProspectService, 'ensureForRoom'>,
  opts: { batchSize: number; log: (line: string) => void },
): Promise<BackfillResult> {
  const result: BackfillResult = { processed: 0, created: 0, linkedExisting: 0, skipped: 0, failed: 0 };
  let last: { id: string; createdAt: Date } | undefined;
  for (;;) {
    const batch = (await prisma.chatRoom.findMany({
      where: last
        ? { AND: [BACKFILL_WHERE, { OR: [{ createdAt: { gt: last.createdAt } }, { createdAt: last.createdAt, id: { gt: last.id } }] }] }
        : BACKFILL_WHERE,
      select: ROOM_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: opts.batchSize,
    })) as Room[];
    if (batch.length === 0) break;
    for (const room of batch) {
      result.processed++;
      try {
        const ensured = await service.ensureForRoom(room.id);
        if (!ensured) result.skipped++;
        else if (ensured.created) result.created++;
        else result.linkedExisting++;
      } catch (err) {
        result.failed++;
        opts.log(`FAILED room ${room.id} (${room.channel}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // ขยับ keyset ไปที่ห้องสุดท้ายของชุดนี้เสมอ ไม่ว่าจะสำเร็จ/ล้ม/ข้ามกี่ห้อง — กันวนซ้ำชุดเดิมไม่รู้จบ
    // (Ruling R20) — ไม่พึ่งว่าห้องนั้นยังอยู่ใน BACKFILL_WHERE หรือไม่ (ต่างจาก Prisma cursor ที่พึ่ง)
    const lastRoom = batch[batch.length - 1];
    last = { id: lastRoom.id, createdAt: lastRoom.createdAt };
    opts.log(`batch done: processed=${result.processed} created=${result.created} linkedExisting=${result.linkedExisting} failed=${result.failed}`);
  }
  return result;
}

async function assertExpectedDb(prisma: PrismaClient): Promise<void> {
  const expected = process.env.EXPECTED_DB_NAME;
  if (!expected) throw new Error('EXPECTED_DB_NAME is required');
  const [{ current_database }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (current_database !== expected) throw new Error(`DB mismatch: connected to "${current_database}", expected "${expected}"`);
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  try {
    await assertExpectedDb(prisma);
    const plan = await planBackfill(prisma);
    console.log('[plan]', JSON.stringify(plan));
    const confirmed = process.env.CONFIRM_BACKFILL === REQUIRED_CONSENT;
    if (!confirmed) {
      console.log('DRY-RUN — set CONFIRM_BACKFILL=YES_I_AM_SURE to write');
      return;
    }
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
      throw new Error('production requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE');
    }
    const service = new ChatProspectService(prisma);
    const result = await runBackfill(prisma, service, {
      batchSize: Number(process.env.BATCH_SIZE ?? 500),
      log: (l) => console.log('[run]', l),
    });
    console.log('[result]', JSON.stringify(result));
    // plan.rooms vs result.processed: a sanity check on pagination health, not proof of a bug —
    // new qualifying rooms can legitimately arrive between the plan snapshot and the run (Ruling R20).
    if (result.processed !== plan.rooms) {
      console.warn(
        `[backfill-chat-prospects] WARNING: plan.rooms=${plan.rooms} vs result.processed=${result.processed} (gap=${plan.rooms - result.processed}) — check for a pagination gap or concurrent room activity during the run`,
      );
      process.exitCode = 2;
    }
    if (result.failed > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
