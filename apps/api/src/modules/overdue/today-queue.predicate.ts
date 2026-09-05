import { ContractStatus, PaymentStatus, Prisma } from '@prisma/client';
import { bangkokStartOfDay } from '../../utils/date.util';

/**
 * เงื่อนไขของ "คิววันนี้" — แหล่งความจริงเดียว
 *
 * เคยถูกคัดลอกด้วยมือไว้ 2 ที่ (`queue.service.ts` = รายการที่พนักงานเห็น และ
 * `kpi.service.ts` = ตัวเลข "คิววันนี้ทั้งหมด" ที่อยู่เหนือรายการนั้น) ⇒ แก้ที่เดียว
 * แล้วอีกที่ค้าง = **หัวข้อขึ้น 0 ราย ทั้งที่ข้างล่างมีการ์ด 3 ใบ** ห้ามแตกออกเป็นสำเนาอีก
 */

/**
 * สถานะสัญญาที่ถือว่า "ต้องโทรตามวันนี้"
 *
 * `DEFAULT` (ผิดนัด ≥2 งวดติด) อยู่ในลิสต์ตั้งแต่ 2026-09-05 (คำสั่งเจ้าของ) —
 * มันเป็นสถานะที่ **ต่อจาก** `OVERDUE` และไม่มีทางกลับ (`overdue-lifecycle-cron`
 * Step 1 flip เฉพาะ `status:'ACTIVE'` · Step 2 `OVERDUE → DEFAULT`) ⇒ ก่อนหน้านี้
 * สัญญาหลุดจากคิวตอนที่มันแย่ลง
 *
 * วัดบน prod วันที่แก้: แท็บนี้ว่างเปล่า **0 แถว** ทั้งที่มีลูกหนี้ค้าง 40 / 70 / 101 วัน
 *
 * `ACTIVE` ต้องอยู่ด้วยเสมอ — สัญญาที่เพิ่งเลยกำหนดยังไม่ถูก cron เลื่อนเป็น `OVERDUE`
 * จนกว่าจะถึงรอบของมัน
 */
export const TODAY_QUEUE_CONTRACT_STATUSES: ContractStatus[] = [
  ContractStatus.ACTIVE,
  ContractStatus.OVERDUE,
  ContractStatus.DEFAULT,
];

/**
 * งวดที่ยังเก็บเงินไม่ครบ
 * ⚠️ พิมพ์เป็น `PaymentStatus[]` เสมอ ห้ามใช้ string ธรรมดา + `as any` —
 * ค่าที่ไม่มีอยู่จริงใน enum ทำให้ Prisma โยน error ตอน runtime แล้ว cron พังเงียบ
 * (บทเรียนจาก #1507 ที่ทำคิวจ่ายงานตายไป 10 รอบเช้าโดยไม่มีใครรู้)
 */
export const UNSETTLED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.OVERDUE,
  PaymentStatus.PARTIALLY_PAID,
];

/**
 * สัญญาที่ต้องโทรตาม "วันนี้": มีงวดถึงกำหนดที่ยังเก็บไม่ครบ · ไม่ถูกผู้จัดการพักไว้ ·
 * และยังไม่มีใครโทรตั้งแต่เที่ยงคืนตามเวลาไทย
 *
 * ⚠️ คืน `OR` ระดับบนสุด — ผู้เรียกที่จะเติมเงื่อนไขต้องใช้ `AND` ห้ามเขียนทับ `OR`
 * ไม่งั้นด่านพักของผู้จัดการจะหายไปเงียบ ๆ
 */
export function todayQueueWhere(
  now: Date,
  branchScope: Prisma.ContractWhereInput = {},
): Prisma.ContractWhereInput {
  return {
    ...branchScope,
    status: { in: TODAY_QUEUE_CONTRACT_STATUSES },
    deletedAt: null,
    OR: [{ blockAutoEscalation: null }, { blockAutoEscalation: { lt: now } }],
    payments: {
      some: {
        dueDate: { lte: now },
        status: { in: UNSETTLED_PAYMENT_STATUSES },
      },
    },
    callLogs: { none: { calledAt: { gte: bangkokStartOfDay(now) } } },
  };
}
