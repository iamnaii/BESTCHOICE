import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { formatDateTime } from '../../../utils/thai-date.util';

/** tag ของงาน "ลูกค้าชำระยอดค้างผ่านลิงก์แจ้งล็อกแล้ว — ตรวจยอดแล้วปลดล็อค" (Task 42) */
export const LOCK_PAID_UNLOCK_TODO_TAG = 'lock-paid-unlock';

/** กุญแจกันซ้ำของงาน (`Todo.requestKey` — unique) = หนึ่งงานต่อหนึ่งลิงก์แจ้งล็อก (ลิงก์จ่ายได้ครั้งเดียว — webhook ตั้ง USED) */
export function lockPaidUnlockTodoKey(sourceLinkId: string): string {
  return `lock-paid-unlock:${sourceLinkId}`;
}

const logger = new Logger('LockPaidUnlockTodo');

/**
 * Task 42 (คำตัดสินเจ้าของ #44) — ข้อความแจ้งล็อกบอกลูกค้า "ชำระยอดค้าง … แล้วเจ้าหน้าที่จะปลดล็อคให้" ⇒ เมื่อ webhook PaySolutions ยืนยันเงิน
 * ของลิงก์ `AMOUNT` ที่กฎแจ้งล็อก (`DEVICE_LOCKED`) สร้าง ให้มีงาน HIGH ถึงเจ้าหน้าที่ตรวจยอดแล้วปลดล็อค
 *
 * - เรียก**หลังธุรกรรมรับเงิน commit** เท่านั้น (ไม่อยู่ในธุรกรรม Serializable ของการรับเงิน) · ไม่ throw — งานพังต้องไม่ทำให้ webhook ล้ม
 *   (เงินเข้าและลงบัญชีแล้ว) แจ้ง Sentry แทน
 * - **ไม่ปลดล็อคเอง ไม่เรียกอะไรของ MDM ไม่อ่านสถานะล็อก** (คำสั่งเจ้าของ "ห้ามยุ่งกับการเชื่อม MDM")
 * - งานเดียวต่อหนึ่งลิงก์: `upsert` ด้วย `requestKey` (unique) แบบไม่แก้งานที่มีอยู่ — webhook ส่งซ้ำจบที่ด่านลิงก์ USED ก่อนถึงตรงนี้อยู่แล้ว
 * - ผู้สร้าง = ผู้ใช้ระบบ · ผู้รับ = เจ้าของที่ active คนแรก (แบบคำขอตัดสินค้า — ปุ่มปลดล็อคเปิดเฉพาะ OWNER / FM · รีวิว M2) · งานไม่ผูกห้องแชท
 *   (role อื่นที่เปิดหน้างานยังเห็น) · ผูกสาขาของสัญญา (กรองตามสาขาได้)
 */
export async function createLockPaidUnlockTodo(
  prisma: Pick<PrismaService, 'paymentLink' | 'user' | 'todo'>,
  trackingLink: { sourceLinkId: string | null },
  paid: { paidAmount: Prisma.Decimal; refno: string; paidAt: Date },
): Promise<void> {
  const sourceLinkId = trackingLink.sourceLinkId;
  if (!sourceLinkId) return;
  try {
    const source = await prisma.paymentLink.findUnique({
      where: { id: sourceLinkId },
      select: {
        id: true,
        purpose: true,
        sourceEvent: true,
        contract: { select: { id: true, contractNumber: true, branchId: true } },
      },
    });
    if (
      !source?.contract ||
      source.purpose !== 'AMOUNT' ||
      source.sourceEvent !== 'DEVICE_LOCKED'
    ) {
      return;
    }
    const contract = source.contract;

    const system = await prisma.user.findFirst({
      where: { isSystemUser: true, deletedAt: null },
      select: { id: true },
    });
    if (!system) {
      Sentry.captureMessage(
        'PaySolutions webhook: no SYSTEM user — lock-paid unlock Todo skipped',
        {
          level: 'error',
          tags: { module: 'paysolutions', action: 'lock-paid-unlock-todo' },
          extra: { sourceLinkId, contractNumber: contract.contractNumber, refno: paid.refno },
        },
      );
      logger.error(
        `ไม่พบผู้ใช้ SYSTEM — ไม่ได้สร้างงานปลดล็อคของสัญญา ${contract.contractNumber} (refno=${paid.refno})`,
      );
      return;
    }

    // รีวิว M2 — ผู้รับ = เจ้าของที่ active คนแรก (ค้นแบบเดียวกับคำขอตัดสินค้า `stock-adjustments.service.ts`) — ปุ่ม/endpoint ปลดล็อค
    // เปิดเฉพาะ OWNER / FINANCE_MANAGER · ผู้ใช้ระบบ (isActive = false) ไม่เข้าเงื่อนไข · ไม่มี = งานไม่ระบุผู้รับ
    const owner = await prisma.user.findFirst({
      where: { role: 'OWNER', isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    const amount = paid.paidAmount
      .toNumber()
      .toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await prisma.todo.upsert({
      where: { requestKey: lockPaidUnlockTodoKey(source.id) },
      update: {},
      create: {
        requestKey: lockPaidUnlockTodoKey(source.id),
        title: `ลูกค้าชำระยอดค้างผ่าน LINE แล้ว — ตรวจยอดแล้วปลดล็อคเครื่อง สัญญา ${contract.contractNumber}`,
        description:
          `ลูกค้าชำระยอดค้าง ${amount} บาท ผ่านลิงก์ในข้อความแจ้งล็อกเครื่อง (Pay Solutions เลขอ้างอิง ${paid.refno}) ` +
          `เมื่อ ${formatDateTime(paid.paidAt)} น. — ระบบลงรับชำระเข้างวดแล้ว แต่ระบบไม่ได้ปลดล็อคเครื่องให้\n` +
          `ตรวจยอดที่หน้ารายละเอียดสัญญา ${contract.contractNumber} (เมนู สัญญาผ่อนชำระ) แล้วปลดล็อคที่การ์ด "อุปกรณ์ MDM" ` +
          `ปุ่ม "ปลดล็อค" (สิทธิ์: เจ้าของ / ผู้จัดการการเงิน) · ถ้าไม่เห็นการ์ด "อุปกรณ์ MDM" หรือการ์ดไม่มีปุ่ม "ปลดล็อค" ` +
          `(เช่น "ไม่พบใน MDM") แจ้งเจ้าของ`,
        priority: 'HIGH',
        tags: [LOCK_PAID_UNLOCK_TODO_TAG],
        createdById: system.id,
        assigneeId: owner?.id ?? null,
        branchId: contract.branchId,
      },
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { module: 'paysolutions', action: 'lock-paid-unlock-todo' },
      extra: { sourceLinkId, refno: paid.refno },
    });
    logger.error(
      `สร้างงานปลดล็อคหลังเงินเข้าไม่สำเร็จ (sourceLinkId=${sourceLinkId}, refno=${paid.refno}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
