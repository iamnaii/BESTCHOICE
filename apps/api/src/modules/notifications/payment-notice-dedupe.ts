import { AutoTriggerType, TriggerStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokStartOfDay } from '../../utils/date.util';
import { NotificationCategory } from './notification-category.enum';

/**
 * Task 30 (เจ้าของตัดสิน 31 ต.ค. 2026) — **ข้อความเรื่องงวดทาง LINE งวดละหนึ่งข้อความต่อวัน** แยกสองชนิด:
 *
 * | ชนิด | วัน | ตัวหลัก | ตัวสำรอง |
 * |---|---|---|---|
 * | `REMINDER` เตือนค่างวด (ข้อ 1) | T-3 / T-1 / T0 | A1 `NotificationReminderService.sendPaymentReminders` 08:00 | บอท A8 `AutoTriggerService.runDailyReminders` 09:00 (T-5..T0) |
 * | `OVERDUE` แจ้งค้างชำระ (รอบ 2 ข้อ 3) | T+1 / T+3 | A2 `NotificationReminderService.sendOverdueNotices` 09:00 (T+1/+3/+7) | บอท `AutoTriggerService.runDailyEscalations` 10:00 (T+1/+3) |
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
    // ทางสำรอง template/ข้อความ/SMS ของ A1 ลงหมวดนี้
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
