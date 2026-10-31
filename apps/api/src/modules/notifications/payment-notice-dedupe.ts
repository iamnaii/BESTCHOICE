import { AutoTriggerType, Prisma, TriggerStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addBkkDays, bangkokStartOfDay } from '../../utils/date.util';
import { ACTIVE_FINANCE_LINK_WHERE } from '../line-oa/services/otp-verified-customer';
import { NotificationCategory } from './notification-category.enum';

/**
 * Task 30 (เจ้าของตัดสิน 31 ต.ค. 2026) — **ข้อความเรื่องงวดทาง LINE งวดละหนึ่งข้อความต่อวัน** แยกสองชนิด:
 *
 * | ชนิด | วัน | ตัวหลัก | ตัวสำรอง |
 * |---|---|---|---|
 * | `REMINDER` เตือนค่างวด (ข้อ 1) | T-3 / T-1 / T0 | A1 `NotificationReminderService.sendPaymentReminders` 08:00 | บอท A8 `AutoTriggerService.runDailyReminders` 09:00 (T-5..T0) |
 * | `OVERDUE` แจ้งค้างชำระ (รอบ 2 ข้อ 3) | T+1 / T+3 | A2 `NotificationReminderService.sendOverdueNotices` 09:00 (T+1/+3/+7) | บอท `AutoTriggerService.runDailyEscalations` 10:00 (T+1/+3) |
 *
 * `OVERDUE` ยังเว้นให้ข้อความทวงระดับสัญญาที่ส่งแล้ววันนี้ (`findContractsDunnedToday` — รอบ 4 I2)
 *
 * **T-3 (รอบ 2 ข้อ 1):** งวดที่ลิงก์ชำระอัตโนมัติ (A6 `CollectionsNotifierService.sendAutoPaymentLinks` 08:30 — การ์ด "แจ้งเตือนค่างวด" +
 * ปุ่มจ่าย) จะส่งวันนี้ = การ์ดลิงก์ชำระเป็นข้อความเดียวของวัน: A1 (รันก่อน 08:00) ตัดสินจาก**เงื่อนไขของ A6 เอง** (`autoPayLinkPaymentWhere` —
 * ตัวเดียวกับที่ A6 ใช้ค้นงวด ไม่ใช่สำเนา) แล้วเว้นให้ · A6 ลงแถว SENT หมวด REMINDER ⇒ บอท 09:00 / A1 ที่สั่งรันซ้ำเห็นว่าส่งแล้ว ·
 * A6 ไม่ส่งงวดที่ได้ข้อความเตือนวันนี้แล้ว · **A6 ส่งไม่ผ่าน** (สร้างลิงก์/ push พัง — แถว FAILED) ⇒ บอท 09:00 ส่งเตือนแทน (ตัวสำรองเดิม
 * ไม่ต้องมีทางใหม่) และ A1 ที่สั่งรันซ้ำหลังจากนั้นเลิกเว้น (`autoPayLinkFailedToday`) ⇒ ลูกค้ายังได้หนึ่งข้อความ · A6 ไม่มีด่าน PDPA (เดิม)
 *
 * ตัวหลัก = ตัวที่ผ่านด่าน PDPA · ส่ง Flex (เลขสัญญา/งวด + ปุ่มตอบเร็ว) · มีบันทึกใน `notification_logs` · ไม่ผูก LINE = SMS ·
 * บอท (ข้อความล้วน + เลขบัญชี · **ไม่มีด่าน PDPA** · `chat_auto_triggers`) = ตัวสำรอง: ส่งเฉพาะเมื่อวันนี้ตัวหลักยังไม่ได้ส่งงวดนั้น
 * (ข้ามเพราะไม่มี consent / สัญญาหรืองวดไม่เข้าเงื่อนไขของตัวหลัก / ส่งไม่ผ่านจนหมดคิวส่งซ้ำ) · กลับกันตัวหลักข้ามเมื่อบอทส่งงวดนั้นไปแล้ว
 * วันนี้ (สั่งรันบอทก่อน · สั่งรันตัวหลักซ้ำหลัง outage) ⇒ ไม่ขึ้นกับลำดับ cron · ฝั่งที่ส่งไม่ผ่าน (บอท `FAILED` / ตัวหลักหมดคิวส่งซ้ำ)
 * ไม่กันอีกฝั่ง · "วันนี้" = วันปฏิทินไทย (`bangkokStartOfDay`) ไม่ขึ้นกับ TZ ของเครื่อง
 *
 * ช่องว่างที่เหลือ: สองงานรันพร้อมกันในวินาทีเดียวกัน (ต่างคนต่างยังไม่เห็นแถวของอีกฝั่ง) — ตารางเวลาไม่ซ้อนกัน
 * เกิดได้เฉพาะสั่งรันมือตรงจังหวะ (`POST notifications/cron/*` · `POST chatbot/finance/test/run-*`)
 */
export type PaymentNoticeKind = 'REMINDER' | 'OVERDUE';

/** หัวข้อที่ A1 ลง `notification_logs` (ทาง Flex) */
export const PAYMENT_REMINDER_SUBJECT = 'แจ้งเตือนค่างวด';
/** หัวข้อที่ A2 ลง `notification_logs` (ทาง Flex) */
export const OVERDUE_NOTICE_SUBJECT = 'แจ้งค้างชำระ';

const KINDS: Record<
  PaymentNoticeKind,
  { subject: string; category: NotificationCategory; botTypes: readonly AutoTriggerType[] }
> = {
  REMINDER: {
    subject: PAYMENT_REMINDER_SUBJECT,
    // ทางสำรอง template/ข้อความ/SMS ของ A1 + การ์ดลิงก์ชำระอัตโนมัติ (A6) ลงหมวดนี้
    category: NotificationCategory.REMINDER,
    botTypes: [
      AutoTriggerType.REMINDER_T_MINUS_5,
      AutoTriggerType.REMINDER_T_MINUS_3,
      AutoTriggerType.REMINDER_T_MINUS_1,
      AutoTriggerType.REMINDER_T_DAY,
    ],
  },
  OVERDUE: {
    subject: OVERDUE_NOTICE_SUBJECT,
    // ทางสำรอง template `payment.overdue_day_*`/ข้อความ/SMS ของ A2 — relatedId = id งวด (ผู้ส่งทวงอื่นใช้ id สัญญา)
    category: NotificationCategory.DUNNING,
    botTypes: [AutoTriggerType.ESCALATION_T_PLUS_1, AutoTriggerType.ESCALATION_T_PLUS_3],
  },
};

/** ชนิดของข้อความบอทแต่ละ `AutoTriggerType` — `null` = ไม่อยู่ในกติกานี้ */
export function botNoticeKind(type: AutoTriggerType): PaymentNoticeKind | null {
  if (KINDS.REMINDER.botTypes.includes(type)) return 'REMINDER';
  if (KINDS.OVERDUE.botTypes.includes(type)) return 'OVERDUE';
  return null;
}

/** idempotency key ของ `chat_auto_triggers` — นิยามเดียวที่บอท (เขียน) และตัวหลัก (อ่าน) ใช้ */
export function autoTriggerReferenceKey(type: AutoTriggerType, paymentId: string): string {
  return `${type}:${paymentId}`;
}

/**
 * ตัวหลักส่งข้อความชนิดนี้ของงวดนี้ถึงลูกค้าแล้ววันนี้ — หรือยังถือการส่งอยู่ (คิวส่งซ้ำ `RETRY_PENDING` · รอเวลาทำการ `DELAYED`:
 * ส่งเองภายหลัง จึงไม่ให้บอทซ้อน) · นับทุกทาง: Flex (หัวข้อของชนิด) และทางสำรอง template/ข้อความ/SMS (หมวดของชนิด — หัวข้อเป็น
 * ของ template หรือว่าง) · `SKIPPED` (ไม่มี consent) / `BLOCKED` (เช่นช่วงผ่อนผันหลังผูก LINE) / `FAILED` = ไม่ได้ส่ง
 */
export async function paymentNoticeSentToday(
  prisma: Pick<PrismaService, 'notificationLog'>,
  kind: PaymentNoticeKind,
  paymentId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const dayStart = bangkokStartOfDay(now);
  const { subject, category } = KINDS[kind];
  const row = await prisma.notificationLog.findFirst({
    where: {
      relatedId: paymentId,
      deletedAt: null,
      AND: [
        { OR: [{ subject }, { category }] },
        {
          OR: [
            { status: 'SENT', sentAt: { gte: dayStart } },
            { status: { in: ['RETRY_PENDING', 'DELAYED'] }, createdAt: { gte: dayStart } },
          ],
        },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

/** หัวข้อแถวของแจ้งสถานะสัญญาค้างชำระ (A3 — รอบเช้า 08:05 `CollectionsNotifierService`) */
export const STATUS_NOTICE_SUBJECT = 'แจ้งสถานะสัญญาค้างชำระ';
/** แจ้งสถานะที่ส่ง**แทน**ข้อความขั้นทวงของคืนเดียวกัน (สัญญาเปลี่ยนสถานะ + เลื่อนขั้นคืนเดียวกัน — หนึ่งข้อความต่อสัญญาจากรอบเช้า) */
export const STATUS_NOTICE_IN_PLACE_OF_ESCALATION_SUBJECT =
  'แจ้งสถานะสัญญาค้างชำระ (แทนข้อความขั้นทวง)';
/**
 * Task 30 รอบ 4 m4 — หัวข้อที่เพดานความถี่ DUNNING วันละครั้งของ `ComplianceService` **ไม่นับ**: แจ้งสถานะที่ไม่ได้ส่งแทนขั้นทวง —
 * ก่อนรอบ 3 แจ้งสถานะ (00:30) ไม่ลงแถวเลย ⇒ ไม่เคยปิดข้อความทวงอื่นของสัญญาในวันนั้น (พนักงานกดส่ง · กฎ CALL_NO_ANSWER / DEVICE_LOCKED) ·
 * แถวนี้มีไว้ให้กันส่งซ้ำ (`findContractsDunnedToday`) เท่านั้น · แจ้งสถานะที่ส่งแทนขั้นทวง**นับ** เหมือนแถวขั้นทวง (01:00) ที่มันแทน
 */
export const FREQUENCY_CAP_EXEMPT_SUBJECTS: readonly string[] = [STATUS_NOTICE_SUBJECT];

/**
 * Task 30 รอบ 4 (รีวิวรอบ 3 I2 · เจ้าของ: **ข้อความทวงหลังครบกำหนดวันละข้อความเดียว**) — สัญญาในชุดนี้ที่ได้ข้อความทวง**ระดับสัญญา**แล้ววันนี้
 * หรือยังถือการส่งอยู่: แถวหมวด DUNNING ที่ `relatedId` = id สัญญา — แจ้งสถานะ (A3) / ขั้นทวง (A4) / แจ้งล็อก ของรอบเช้า 08:05 ·
 * พนักงานกดส่ง · กฎทวงตามเหตุการณ์ · ทุกช่องทาง (LINE / SMS แทน) · `SENT` วันนี้ หรือ `RETRY_PENDING` / `DELAYED` ที่สร้างวันนี้ (ส่งเองภายหลัง)
 *
 * ผู้อ่าน: A2 / บอททวง T+1/T+3 ข้ามงวดของสัญญาเหล่านี้ (เดิม T+7 = วันเปลี่ยนเป็น OVERDUE ได้แจ้งสถานะ 08:05 + แจ้งค้างชำระ 09:00 ของงวดเดียวกัน ·
 * แถวของ A2 ผูก id งวดจึงไม่ถูกนับที่นี่) · รอบเช้า 08:05 ที่สั่งรันซ้ำไม่ส่งซ้ำ · **ไม่ใช่**เพดานความถี่ของ `ComplianceService` (คนละกติกา —
 * เพดานนับเฉพาะแถวที่ผูกลูกค้า + สัญญา และยกเว้นแจ้งสถานะที่ไม่ได้ส่งแทนขั้นทวง — รอบ 4 m4)
 */
export async function findContractsDunnedToday(
  prisma: Pick<PrismaService, 'notificationLog'>,
  contractIds: string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  if (contractIds.length === 0) return new Set();
  const dayStart = bangkokStartOfDay(now);
  const rows = await prisma.notificationLog.findMany({
    where: {
      relatedId: { in: [...new Set(contractIds)] },
      category: NotificationCategory.DUNNING,
      deletedAt: null,
      OR: [
        { status: 'SENT', sentAt: { gte: dayStart } },
        { status: { in: ['RETRY_PENDING', 'DELAYED'] }, createdAt: { gte: dayStart } },
      ],
    },
    select: { relatedId: true },
  });
  return new Set(rows.map((row) => row.relatedId).filter((id): id is string => id !== null));
}

/**
 * บอทส่ง (`SENT`) หรือกำลังส่ง (`PENDING` — แถวถูกจองก่อน push) ข้อความชนิดนี้ของงวดนี้วันนี้ · `FAILED` ไม่นับ ⇒ ตัวหลักส่งแทนได้
 */
export async function botNoticeSentToday(
  prisma: Pick<PrismaService, 'chatAutoTrigger'>,
  kind: PaymentNoticeKind,
  customerId: string,
  paymentId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await prisma.chatAutoTrigger.findFirst({
    where: {
      customerId,
      referenceKey: {
        in: KINDS[kind].botTypes.map((type) => autoTriggerReferenceKey(type, paymentId)),
      },
      status: { in: [TriggerStatus.SENT, TriggerStatus.PENDING] },
      createdAt: { gte: bangkokStartOfDay(now) },
      deletedAt: null,
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * งวดที่ครบกำหนด `daysFromToday` วันจากวันนี้ตามปฏิทินไทย เป็นช่วง `dueDate` [gte, lt) — **นิยามเดียวของ "T±n"** ของผู้ส่งข้อความเรื่องงวดทุกตัว
 * (A1 · A2 · A6 · บอท) · `dueDate` จริงเก็บที่เที่ยงคืนไทย (ตารางงวด · สัญญานำเข้า) — รอบ 3 C1: เดิม A1/A2 ใช้วัน UTC
 * (`toISOString().split('T')[0]`) และบอทใช้ `setHours` ตาม TZ เครื่อง ⇒ บนข้อมูลจริง A1 ส่ง T-4/T-2/T-1 · A2 ส่ง T0 ("เลยกำหนด 0 วัน")/T+2/T+6 ·
 * ไม่ขึ้นกับ TZ ของเครื่อง
 */
export function noticeDueWindow(now: Date, daysFromToday: number): { gte: Date; lt: Date } {
  const gte = addBkkDays(bangkokStartOfDay(now), daysFromToday);
  return { gte, lt: addBkkDays(gte, 1) };
}

/** หัวข้อที่ลิงก์ชำระอัตโนมัติ (A6) ลง `notification_logs` — แถว SENT (ส่งแล้ว) / FAILED (ส่งไม่ผ่าน) */
export const AUTO_PAY_LINK_SUBJECT = 'ลิงก์ชำระอัตโนมัติ';
/** ลิงก์ชำระอัตโนมัติส่งก่อนวันครบกำหนดกี่วัน (ตามวันไทย) */
export const AUTO_PAY_LINK_DAYS_BEFORE_DUE = 3;

/**
 * งวดที่ลิงก์ชำระอัตโนมัติ (A6) ส่งวันนี้ — **เงื่อนไขเดียว**: A6 ใช้ค้นงวด · A1 ใช้ตัดสินว่าจะเว้นให้ ·
 * ครบกำหนดอีก `AUTO_PAY_LINK_DAYS_BEFORE_DUE` วันตามวันไทย · งวด PENDING · สัญญา ACTIVE · ลูกค้าไม่ถูกลบและผูก LINE การเงินด้วย OTP
 */
export function autoPayLinkPaymentWhere(now: Date = new Date()): Prisma.PaymentWhereInput {
  return {
    status: 'PENDING',
    deletedAt: null,
    dueDate: noticeDueWindow(now, AUTO_PAY_LINK_DAYS_BEFORE_DUE),
    contract: {
      deletedAt: null,
      status: { in: ['ACTIVE'] },
      customer: { lineLinks: { some: ACTIVE_FINANCE_LINK_WHERE }, deletedAt: null },
    },
  };
}

/** งวดในชุดนี้ที่ลิงก์ชำระอัตโนมัติจะส่งวันนี้ — query เดียวต่อรอบ */
export async function findAutoPayLinkPaymentIds(
  prisma: Pick<PrismaService, 'payment'>,
  paymentIds: string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set();
  const rows = await prisma.payment.findMany({
    where: { id: { in: paymentIds }, ...autoPayLinkPaymentWhere(now) },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** ลิงก์ชำระอัตโนมัติของงวดนี้ส่งไม่ผ่านแล้ววันนี้ (A6 ลงแถว FAILED) ⇒ A1 ไม่ต้องเว้นให้อีก */
export async function autoPayLinkFailedToday(
  prisma: Pick<PrismaService, 'notificationLog'>,
  paymentId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await prisma.notificationLog.findFirst({
    where: {
      relatedId: paymentId,
      subject: AUTO_PAY_LINK_SUBJECT,
      status: 'FAILED',
      createdAt: { gte: bangkokStartOfDay(now) },
      deletedAt: null,
    },
    select: { id: true },
  });
  return row !== null;
}
