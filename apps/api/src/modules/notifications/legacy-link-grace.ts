import { LineChannelType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTIVE_FINANCE_LINK_WHERE } from '../line-oa/services/otp-verified-customer';
import { NotificationCategory } from './notification-category.enum';

/**
 * Task 30 ข้อ 2 (เจ้าของตัดสิน 31 ต.ค. 2026) — **ผ่อนผัน 7 วันหลังผูก LINE สำหรับสัญญาที่นำเข้าจากระบบเดิม**
 *
 * ลูกค้าระบบเดิม (~470 สัญญานำเข้า 30 พ.ย. — `Contract.legacyContractCode` · ส่วนใหญ่ OVERDUE) ผูก LINE การเงินด้วย OTP แล้ว
 * ต้องไม่โดนทวงทาง LINE ทันที: ช่วง `LEGACY_LINK_DUNNING_GRACE_DAYS` วันแรกนับจาก **การผูก LINE การเงินครั้งแรกของลูกค้า**
 * (รอบ 2 ข้อ 4 — ยืนยัน OTP ซ้ำ / ยกเลิกแล้วผูกกลับ ไม่เริ่มนับใหม่ · `financeLinkAtOrBefore`) **ไม่ส่งข้อความทวง/แจ้งสถานะค้างชำระทาง LINE**
 * ของสัญญานั้น — เตือนค่างวด (หนึ่งข้อความต่อวัน — `payment-notice-dedupe.ts`) ·
 * ใบเสร็จ · ลิงก์ชำระ ยังส่งตามเดิม · สัญญาที่ไม่ได้นำเข้า (ไม่มี `legacyContractCode`) และ SMS ไม่เปลี่ยน ·
 * ข้อความที่ถูกระงับไม่ถูกเลื่อนไปส่งทีหลัง (หมดช่วงแล้วรอบทวงถัดไปเดินตามปกติ)
 *
 * **ระงับเฉพาะที่ระบบส่งเอง** (รอบ 2 ข้อ 2) — พนักงานกดส่งเองไม่ถูกระงับ: ผู้เรียกระบุ `{ manual: true }` ตรง ๆ (คิวทวงถาม ส่ง LINE/ส่งรวด ·
 * ส่งซ้ำ DunningAction · `POST notifications/send|send-from-template|bulk`) — ไม่เดาจากอย่างอื่น
 *
 * จุดบังคับ (ทุกทางที่ระบบส่งข้อความหมวดทวง `DUNNING` ทาง LINE เอง):
 * - `NotificationDispatchService.send` — ก่อนด่าน compliance (รอบกฎทวง `DunningEngineService` ตามวัน/ตามเหตุการณ์ · ข้อความทางสำรองของ
 *   template) · คิวส่งซ้ำแถว DELAYED ไม่ต้องตรวจซ้ำ: ส่งทาง LINE ได้ต้องผูกอยู่แล้วตอนสร้าง ⇒ ผูกครั้งแรกอยู่ก่อนนั้น ช่วงผ่อนผันจึงเปลี่ยนจาก
 *   "อยู่" เป็น "พ้น" ได้ทางเดียว (ที่อยู่ในช่วงถูกระงับตั้งแต่ตอนสร้าง ไม่กลายเป็น DELAYED)
 * - `NotificationDispatchService.sendFromTemplate` — template หมวด DUNNING ช่อง LINE ก่อนทาง Flex (Flex ไม่ผ่าน `send`):
 *   `dunning.*` (A4 ขั้นทวง) · `payment.overdue_day_*` · `mdm.lock_notice` · `contract.status_*` · `payment.auto_link`
 * - ผู้ส่ง Flex/ข้อความตรงที่ไม่ผ่าน dispatch: A2 `NotificationReminderService.sendOverdueNotices` ·
 *   A3 `CollectionsNotifierService.notifyStatusChangedCustomers` · A8 ทวงหลังเลยกำหนด `AutoTriggerService` (ESCALATION_T_PLUS_1/3)
 * ทุกจุดทิ้งแถว `notification_logs` สถานะ `BLOCKED` เหตุผล `LEGACY_LINK_GRACE` ให้ตรวจย้อนได้
 */

/** จำนวนวันผ่อนผันหลังผูก LINE — ค่านี้ที่เดียว */
export const LEGACY_LINK_DUNNING_GRACE_DAYS = 7;

/** `notification_logs.block_reason` / `ComplianceBlockReason` ของข้อความที่ถูกระงับด้วยกติกานี้ */
export const LEGACY_LINK_GRACE_BLOCK_REASON = 'LEGACY_LINK_GRACE' as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** ผูกครั้งแรกหลังเวลานี้ = ยังอยู่ในช่วงผ่อนผัน (ครบ 7 × 24 ชม. แล้ว = พ้นช่วง) */
export function legacyLinkGraceCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - LEGACY_LINK_DUNNING_GRACE_DAYS * DAY_MS);
}

/**
 * แถว FINANCE ที่แสดงว่าลูกค้าผูกแล้วตั้งแต่ `cutoff` ลงไป (`linkedAt` หรือ `createdAt` ≤ `cutoff` · **ทุกสถานะ** รวมแถวที่ยกเลิกผูก/ถูกลบ) —
 * "ผูกครั้งแรกหลัง `cutoff`" ⇔ ไม่มีแถวแบบนี้ (`none`) · นิยามเดียวของ "ครั้งแรก": แถวมีได้หนึ่งแถวต่อลูกค้าต่อช่อง (unique `customerId + channel`) และ `VerificationService.bind` **ตั้ง `linkedAt` ใหม่ทุกครั้ง**ที่ผูก
 * (ยืนยันซ้ำ · ผูกกลับ · เปลี่ยน LINE) แต่ไม่แตะ `createdAt` ⇒ `createdAt` ของแถว = เวลาผูกครั้งแรก
 * (ข้อจำกัด: แถวที่ย้ายมาจากลูกค้าอื่นเพราะ LINE เดียวกันยืนยันกับลูกค้าคนใหม่ ถือ `createdAt` ของลูกค้าเดิม ⇒ ช่วงผ่อนผันสั้นลง/หมด — ทางที่ทวงตามเดิม)
 */
function financeLinkAtOrBefore(cutoff: Date): Prisma.CustomerLineLinkWhereInput {
  return {
    channel: LineChannelType.FINANCE,
    OR: [{ linkedAt: { lte: cutoff } }, { createdAt: { lte: cutoff } }],
  };
}

/**
 * เงื่อนไขสัญญาที่อยู่ในช่วงผ่อนผัน: นำเข้าจากระบบเดิม + ลูกค้าของสัญญายังผูก LINE การเงินอยู่ (แถว OTP ที่ยังผูก) +
 * ผูกครั้งแรกยังไม่ครบ 7 วัน
 */
export function inLegacyLinkGraceWhere(now: Date = new Date()): Prisma.ContractWhereInput {
  return {
    legacyContractCode: { not: null },
    customer: {
      lineLinks: {
        some: ACTIVE_FINANCE_LINK_WHERE,
        none: financeLinkAtOrBefore(legacyLinkGraceCutoff(now)),
      },
    },
  };
}

/** สัญญาในชุดนี้ที่อยู่ในช่วงผ่อนผัน — query เดียวต่อรอบ cron */
export async function findContractsInLegacyLinkGrace(
  prisma: Pick<PrismaService, 'contract'>,
  contractIds: Iterable<string | null | undefined>,
  now: Date = new Date(),
): Promise<Set<string>> {
  const ids = [...new Set([...contractIds].filter((id): id is string => !!id))];
  if (ids.length === 0) return new Set();
  const rows = await prisma.contract.findMany({
    where: { id: { in: ids }, ...inLegacyLinkGraceWhere(now) },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * สำหรับผู้ส่งที่รู้แค่ `relatedId` ของข้อความ (`notification_logs.related_id` = id สัญญา หรือ id งวด) — ไม่พบ = ไม่อยู่ในช่วง
 * (ส่งตามเดิม: กติกานี้เป็นความผ่อนปรน ไม่ใช่ด่านความปลอดภัย)
 */
export async function isRelatedRecordInLegacyLinkGrace(
  prisma: Pick<PrismaService, 'contract'>,
  relatedId: string | null | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  if (!relatedId) return false;
  const row = await prisma.contract.findFirst({
    where: {
      OR: [{ id: relatedId }, { payments: { some: { id: relatedId } } }],
      ...inLegacyLinkGraceWhere(now),
    },
    select: { id: true },
  });
  return row !== null;
}

/** แถวหลักฐานของข้อความที่ถูกระงับ — `BLOCKED` ไม่เข้าคิวส่งซ้ำ ไม่นับเพดานความถี่ ไม่นับเป็น "ส่งแล้ว" · คืน id แถว */
export async function recordLegacyLinkGraceSkip(
  prisma: Pick<PrismaService, 'notificationLog'>,
  input: {
    recipient: string;
    subject: string | null;
    message: string;
    relatedId: string | null;
    customerId: string | null;
    channelKey?: string | null;
  },
): Promise<string> {
  const log = await prisma.notificationLog.create({
    data: {
      channel: 'LINE',
      channelKey: input.channelKey ?? 'line-finance',
      recipient: input.recipient,
      subject: input.subject,
      message: input.message,
      status: 'BLOCKED',
      relatedId: input.relatedId,
      customerId: input.customerId,
      category: NotificationCategory.DUNNING,
      blockReason: LEGACY_LINK_GRACE_BLOCK_REASON,
      errorMsg: `Compliance block: ${LEGACY_LINK_GRACE_BLOCK_REASON}`,
      sentAt: null,
    },
    select: { id: true },
  });
  return log.id;
}
