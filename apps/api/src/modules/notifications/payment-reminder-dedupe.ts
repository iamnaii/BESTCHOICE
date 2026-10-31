import { AutoTriggerType, TriggerStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokStartOfDay } from '../../utils/date.util';
import { NotificationCategory } from './notification-category.enum';

/**
 * Task 30 ข้อ 1 (เจ้าของตัดสิน 31 ต.ค. 2026) — **เตือนค่างวด งวดละหนึ่งข้อความต่อวัน**
 *
 * ผู้ส่งเตือนค่างวดทาง LINE สองตัวชนวันกัน (T-3 / T-1 / วันครบกำหนด):
 * - A1 `NotificationReminderService.sendPaymentReminders` 08:00 — ด่าน PDPA · Flex + Quick Reply · ลง `notification_logs` ·
 *   ไม่ผูก LINE = SMS
 * - A8 `AutoTriggerService.runDailyReminders` 09:00 — ข้อความล้วน + เลขบัญชี · **ไม่มีด่าน PDPA** · ลง `chat_auto_triggers`
 *
 * ตัวหลัก = A1 (ผ่านด่านยินยอม · Flex ที่มีเลขสัญญา/งวด + ปุ่มตอบเร็ว · มีบันทึกการส่ง) · A8 = ตัวสำรอง: ส่งเฉพาะเมื่อวันนี้ A1 ยังไม่ได้ส่ง
 * งวดนั้น (A1 ข้ามเพราะไม่มี consent / สัญญาไม่ ACTIVE / งวดชำระบางส่วน / ส่งไม่ผ่านจนหมดรอบ) · กลับกัน A1 ข้ามเมื่อ A8 ส่งงวดนั้นไปแล้ว
 * วันนี้ (สั่งรัน A8 ก่อน · สั่งรัน A1 ซ้ำหลัง outage) ⇒ ไม่ขึ้นกับลำดับ cron · ฝั่งที่ส่งไม่ผ่าน (A8 `FAILED` / A1 หมดรอบส่งซ้ำ) ไม่กันอีกฝั่ง ·
 * "วันนี้" = วันปฏิทินไทย (`bangkokStartOfDay`) ไม่ขึ้นกับ TZ ของเครื่อง
 *
 * ช่องว่างที่เหลือ: สองงานรันพร้อมกันในวินาทีเดียวกัน (ต่างคนต่างยังไม่เห็นแถวของอีกฝั่ง) — ตารางเวลา 08:00/09:00 ไม่ซ้อนกัน
 * เกิดได้เฉพาะสั่งรันมือตรงจังหวะ (`POST notifications/cron/payment-reminders` · `POST chatbot/finance/test/run-reminders`)
 */

/** หัวข้อที่ A1 ลง `notification_logs` (ทาง Flex) */
export const PAYMENT_REMINDER_SUBJECT = 'แจ้งเตือนค่างวด';

/** ชนิดเตือนก่อน/วันครบกำหนดของ A8 — ไม่รวม `ESCALATION_*` (ทวงหลังเลยกำหนด ไม่ใช่เตือนค่างวด) */
export const AUTO_TRIGGER_REMINDER_TYPES: readonly AutoTriggerType[] = [
  AutoTriggerType.REMINDER_T_MINUS_5,
  AutoTriggerType.REMINDER_T_MINUS_3,
  AutoTriggerType.REMINDER_T_MINUS_1,
  AutoTriggerType.REMINDER_T_DAY,
];

/** idempotency key ของ `chat_auto_triggers` — นิยามเดียวที่ A8 (เขียน) และ A1 (อ่าน) ใช้ */
export function autoTriggerReferenceKey(type: AutoTriggerType, paymentId: string): string {
  return `${type}:${paymentId}`;
}

/**
 * A1 ส่งเตือนงวดนี้ถึงลูกค้าแล้ววันนี้ — หรือยังถือการส่งอยู่ (คิวส่งซ้ำ `RETRY_PENDING` · รอเวลาทำการ `DELAYED`: ส่งเองภายหลัง
 * จึงไม่ให้ A8 ซ้อน) · นับทุกทางของ A1: Flex (หัวข้อ `PAYMENT_REMINDER_SUBJECT`) และทางสำรอง template/ข้อความ/SMS
 * (หมวด `REMINDER` — หัวข้อเป็นของ template หรือว่าง) · `SKIPPED` (ไม่มี consent) / `BLOCKED` / `FAILED` = ไม่ได้ส่ง
 */
export async function notificationReminderSentToday(
  prisma: Pick<PrismaService, 'notificationLog'>,
  paymentId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const dayStart = bangkokStartOfDay(now);
  const row = await prisma.notificationLog.findFirst({
    where: {
      relatedId: paymentId,
      deletedAt: null,
      AND: [
        {
          OR: [{ subject: PAYMENT_REMINDER_SUBJECT }, { category: NotificationCategory.REMINDER }],
        },
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
 * A8 ส่ง (`SENT`) หรือกำลังส่ง (`PENDING` — แถวถูกจองก่อน push) เตือนงวดนี้วันนี้ · `FAILED` ไม่นับ ⇒ A1 ส่งแทนได้
 */
export async function autoTriggerReminderSentToday(
  prisma: Pick<PrismaService, 'chatAutoTrigger'>,
  customerId: string,
  paymentId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await prisma.chatAutoTrigger.findFirst({
    where: {
      customerId,
      referenceKey: {
        in: AUTO_TRIGGER_REMINDER_TYPES.map((type) => autoTriggerReferenceKey(type, paymentId)),
      },
      status: { in: [TriggerStatus.SENT, TriggerStatus.PENDING] },
      createdAt: { gte: bangkokStartOfDay(now) },
      deletedAt: null,
    },
    select: { id: true },
  });
  return row !== null;
}
