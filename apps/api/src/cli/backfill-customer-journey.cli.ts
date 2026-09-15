/**
 * ย้อนหลัง "แคชการเดินทางของลูกค้า" (customer_journey_states) ให้ลูกค้าทุกคนที่ยังไม่ถูกลบ
 * (synthesis api §7 · แผน 2 การเดินทางของลูกค้า เฟส 1)
 *
 * ทำงานผ่าน JourneyStateService.recompute ตัวเดียวกับ runtime และ cron (journey-state.sql ไฟล์เดียว) —
 * CLI นี้ไม่มีสำเนาตรรกะขั้นที่สอง แค่แบ่งลูกค้าเป็นชุดแล้วเรียก recompute(ids) ทีละชุด
 * รันซ้ำได้ (INSERT … ON CONFLICT) · อย่ารันช่วง cron journey:recompute 03:00–04:30 น. เวลาไทย (ดู docs/superpowers/runbooks/2026-09-15-customer-journey-deploy.md)
 *
 * ลำดับบน prod: deploy → backfill:chat-prospects (ผูกห้องแชทให้ครบ) → backfill:customer-journey
 *
 * ด่านหยุดจริง (ก่อนเขียนอะไร และทำงานตอน dry-run ด้วย ⇒ exit 1):
 * - ห้องที่ backfill:chat-prospects ยังต้องผูก (BACKFILL_WHERE) เกิน 1% ของห้องที่ยังไม่ถูกลบ —
 *   ลูกค้าจากแชทที่ยังไม่ถูกสร้าง/ผูกจะไม่มีแคช และ firstSource/firstChannel ที่ถูกแช่แข็งจะผิด
 *
 * ด่านหลังเขียน (exit 2 = เขียนแล้วแต่ต้องมีคนดู):
 * - JourneyStateService.purchasedParity(): state stage=PURCHASED ≠ ลูกค้าที่ตรง BOUGHT_WHERE (ตัวเดียวกับ cron)
 * - recompute ล้มอย่างน้อยหนึ่งชุด
 * - plan.customers ≠ result.processed (สัญญาณสุขภาพ pagination — ลูกค้าใหม่เข้ามาระหว่างรันก็ทำให้ต่างได้จริง)
 *
 * KEYSET PAGINATION แบบเดียวกับ backfill-chat-prospects (Ruling R20): orderBy (createdAt,id) +
 * WHERE (createdAt,id) > ตัวสุดท้ายของชุดก่อนเสมอ ไม่ใช้ Prisma cursor/skip · ชุดที่ recompute ล้ม
 * ยังขยับคีย์ผ่านไป กันวนซ้ำชุดเดิมไม่รู้จบ (ไม่ใช้ recomputeAll ของ cron — CLI นับ processed/failedCustomers เองเพื่อตัดสิน exit code)
 *
 * PDPA: log มีแค่ id ลูกค้า (uuid) กับตัวเลข — ไม่อ่าน/ไม่พิมพ์ชื่อ เบอร์ เลขบัตร ที่อยู่ ข้อความแชท
 *
 * GUARDS (แบบเดียวกับ backfill-chat-prospects.cli.ts)
 * - EXPECTED_DB_NAME ต้องตรง current_database() ไม่งั้น exit 1
 * - DRY-RUN เป็นค่าตั้งต้น: พิมพ์แผน + ด่าน 1% + parity ของแคชตอนนี้ ไม่เขียนอะไร
 * - CONFIRM_BACKFILL=YES_I_AM_SURE จึงเขียน · NODE_ENV=production ต้องมี ALLOW_PROD_BACKFILL=YES_I_AM_SURE ด้วย
 *
 * ใช้:  EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run backfill:customer-journey            (dry-run)
 *       CONFIRM_BACKFILL=YES_I_AM_SURE ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production \
 *       EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run backfill:customer-journey            (เขียนจริง)
 *       BATCH_SIZE=500 ปรับได้ · dev: DATABASE_URL=… npx ts-node --transpile-only src/cli/backfill-customer-journey.cli.ts
 *
 * รันจริงบน prod เป็น Cloud Run Job ในอิมเมจ API แบบเดียวกับ bestchoice-seed-gfin (dry-run ก่อนเสมอ · runbook ใน Task 13)
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { CHAT_SOURCE_PREFIX } from '@installment/shared';
import { PrismaService } from '../prisma/prisma.service';
import { JourneyStateService } from '../modules/customer-journey/journey-state.service';
import { BACKFILL_WHERE as UNLINKED_ROOM_WHERE } from './backfill-chat-prospects.cli';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

/** ห้องไม่มีเจ้าของเกินสัดส่วนนี้ = หยุดจริง (exit 1) */
export const UNLINKED_ROOMS_MAX_RATIO = 0.01;

const LIVE_CUSTOMER_WHERE: Prisma.CustomerWhereInput = { deletedAt: null };
const CUSTOMER_SELECT = { id: true, createdAt: true } as const;

export interface JourneyBackfillPlan {
  /** ลูกค้าที่ยังไม่ถูกลบ = จำนวนที่จะ recompute */
  customers: number;
  /** แถวแคชที่มีอยู่แล้วก่อนรัน */
  existingStates: number;
  /** ลูกค้าที่ตรง BOUGHT_WHERE (จาก purchasedParity) — หลังรันต้องเท่ากับจำนวน state PURCHASED */
  boughtCustomers: number;
  /** ห้องแชทที่ยังไม่ถูกลบ (ตัวหารของด่าน 1%) */
  liveRooms: number;
  /** ห้องที่ backfill:chat-prospects ยังต้องผูก (ตัวตั้งของด่าน 1%) */
  unlinkedRooms: number;
  /** placeholder ที่ถูกรวมแล้ว (deleted_at + merged_into_id) — ตัวอ่านดึง event ของพวกนี้ขึ้นใต้ลูกค้าจริง */
  mergedPlaceholders: number;
  /** placeholder จากแชทที่ถูกลบแต่ไม่มี merged_into_id = การรวมที่ audit ถูกข้าม — รายงานเป็นตัวเลข คาดว่า 0 */
  unmergedDeletedChatPlaceholders: number;
}

export interface JourneyBackfillResult {
  processed: number;
  batches: number;
  failedBatches: number;
  failedCustomers: number;
}

export interface PurchasedParity {
  boughtCustomers: number;
  purchasedStates: number;
  ok: boolean;
}

/** แผน (dry-run): นับอย่างเดียว ไม่เขียน */
export async function planJourneyBackfill(
  prisma: Pick<PrismaClient, 'customer' | 'chatRoom' | 'customerJourneyState'>,
  stateService: Pick<JourneyStateService, 'purchasedParity'>,
): Promise<JourneyBackfillPlan> {
  const [customers, existingStates, parity, liveRooms, unlinkedRooms, mergedPlaceholders, unmergedDeletedChatPlaceholders] =
    await Promise.all([
      prisma.customer.count({ where: LIVE_CUSTOMER_WHERE }),
      prisma.customerJourneyState.count(),
      stateService.purchasedParity(),
      prisma.chatRoom.count({ where: { deletedAt: null } }),
      prisma.chatRoom.count({ where: UNLINKED_ROOM_WHERE }),
      prisma.customer.count({ where: { deletedAt: { not: null }, mergedIntoId: { not: null } } }),
      prisma.customer.count({
        where: { deletedAt: { not: null }, mergedIntoId: null, acquisitionSource: { startsWith: CHAT_SOURCE_PREFIX } },
      }),
    ]);
  return {
    customers,
    existingStates,
    boughtCustomers: parity.bought,
    liveRooms,
    unlinkedRooms,
    mergedPlaceholders,
    unmergedDeletedChatPlaceholders,
  };
}

/** ด่าน 1%: เท่ากับ 1% พอดียังผ่าน · ไม่มีห้องเลย = ผ่าน */
export function unlinkedRoomsGate(plan: Pick<JourneyBackfillPlan, 'liveRooms' | 'unlinkedRooms'>): { ok: boolean; ratio: number } {
  const ratio = plan.liveRooms === 0 ? 0 : plan.unlinkedRooms / plan.liveRooms;
  return { ok: ratio <= UNLINKED_ROOMS_MAX_RATIO, ratio };
}

/**
 * เขียนจริง: วนลูกค้าที่ยังไม่ถูกลบด้วย explicit keyset เดินหน้าเสมอ (Ruling R20) แล้ว recompute ทีละชุด
 * ชุดที่ล้มถูกนับและ log (id ต้น/ท้ายชุด) แล้วขยับคีย์ต่อ
 */
export async function runJourneyBackfill(
  prisma: Pick<PrismaClient, 'customer'>,
  stateService: Pick<JourneyStateService, 'recompute'>,
  opts: { batchSize: number; log: (line: string) => void },
): Promise<JourneyBackfillResult> {
  const result: JourneyBackfillResult = { processed: 0, batches: 0, failedBatches: 0, failedCustomers: 0 };
  let last: { id: string; createdAt: Date } | undefined;
  for (;;) {
    const batch = await prisma.customer.findMany({
      where: last
        ? { AND: [LIVE_CUSTOMER_WHERE, { OR: [{ createdAt: { gt: last.createdAt } }, { createdAt: last.createdAt, id: { gt: last.id } }] }] }
        : LIVE_CUSTOMER_WHERE,
      select: CUSTOMER_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: opts.batchSize,
    });
    if (batch.length === 0) break;
    const ids = batch.map((c) => c.id);
    result.batches++;
    result.processed += ids.length;
    try {
      await stateService.recompute(ids);
    } catch (err) {
      result.failedBatches++;
      result.failedCustomers += ids.length;
      opts.log(`FAILED batch first=${ids[0]} last=${ids[ids.length - 1]} size=${ids.length}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // ขยับ keyset ไปที่ลูกค้าคนสุดท้ายของชุดเสมอ ไม่ว่าชุดนี้จะสำเร็จหรือล้ม (Ruling R20)
    const lastCustomer = batch[batch.length - 1];
    last = { id: lastCustomer.id, createdAt: lastCustomer.createdAt };
    opts.log(`batch done: processed=${result.processed} failedBatches=${result.failedBatches}`);
  }
  return result;
}

/** ด่านหลังเขียน: ใช้ purchasedParity ของ JourneyStateService ตัวเดียวกับ cron journey:recompute */
export async function checkPurchasedParity(stateService: Pick<JourneyStateService, 'purchasedParity'>): Promise<PurchasedParity> {
  const { purchasedStates, bought } = await stateService.purchasedParity();
  return { boughtCustomers: bought, purchasedStates, ok: bought === purchasedStates };
}

export function backfillExitCode(input: {
  plan: Pick<JourneyBackfillPlan, 'customers'>;
  result: JourneyBackfillResult;
  parity: PurchasedParity;
}): 0 | 2 {
  if (!input.parity.ok) return 2;
  if (input.result.failedBatches > 0) return 2;
  if (input.result.processed !== input.plan.customers) return 2;
  return 0;
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
    const stateService = new JourneyStateService(prisma);
    const plan = await planJourneyBackfill(prisma, stateService);
    console.log('[plan]', JSON.stringify(plan));
    const gate = unlinkedRoomsGate(plan);
    if (!gate.ok) {
      throw new Error(
        `ห้องแชทยังไม่มีเจ้าของ ${plan.unlinkedRooms}/${plan.liveRooms} ห้อง (${(gate.ratio * 100).toFixed(2)}%) เกิน ${UNLINKED_ROOMS_MAX_RATIO * 100}% — รัน backfill:chat-prospects ให้ครบก่อน แล้วค่อยรันตัวนี้`,
      );
    }
    console.log('[parity-now]', JSON.stringify(await checkPurchasedParity(stateService)));
    const confirmed = process.env.CONFIRM_BACKFILL === REQUIRED_CONSENT;
    if (!confirmed) {
      console.log('DRY-RUN — set CONFIRM_BACKFILL=YES_I_AM_SURE to write');
      return;
    }
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
      throw new Error('production requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE');
    }
    const result = await runJourneyBackfill(prisma, stateService, {
      batchSize: Number(process.env.BATCH_SIZE ?? 500),
      log: (l) => console.log('[run]', l),
    });
    console.log('[result]', JSON.stringify(result));
    const parity = await checkPurchasedParity(stateService);
    console.log('[parity]', JSON.stringify(parity));
    if (!parity.ok) {
      console.warn(
        `[backfill-customer-journey] WARNING: PURCHASED states=${parity.purchasedStates} vs BOUGHT_WHERE=${parity.boughtCustomers} — แคชไม่ตรงแท็บลูกค้า ตรวจ journey-state.sql หรือมีการขาย/ยกเลิกระหว่างรัน`,
      );
    }
    if (result.processed !== plan.customers) {
      console.warn(
        `[backfill-customer-journey] WARNING: plan.customers=${plan.customers} vs result.processed=${result.processed} — check for a pagination gap or customers created during the run`,
      );
    }
    process.exitCode = backfillExitCode({ plan, result, parity });
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
