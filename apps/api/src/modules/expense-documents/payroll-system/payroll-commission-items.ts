import { ConflictException } from '@nestjs/common';
import type { CommissionStatus, Prisma } from '@prisma/client';
import { STATUS_CHANGED_MSG } from '../../commission/commission-clawback.util';

/**
 * Payroll D4 ส่วนที่ 2 — ผู้เขียนรายการค่าคอมของใบเงินเดือน (ฟังก์ชันธรรมดา ไม่ต้องต่อ service — ลบร่างเรียกได้แม้ไม่ได้ต่อด่าน)
 * - ยังมีผล (live) = `releasedAt` null ชุดเดียวกับดัชนี `payroll_commission_items_one_active_pay` (P2-R12)
 * - ทุกการเขียนแถวค่าคอมเรียงตาม id (ชุดเดียวกับ `clawBackCommissions`) ⇒ ไม่ deadlock กับการยกเลิกใบขาย
 */

/**
 * include ของรายการค่าคอมบนบรรทัดใบเงินเดือน — ชุดเดียวของ findOne และคำตอบของสร้าง/แก้ใบ (Task 6 เติมฟอร์มจากคำตอบที่บันทึก) ·
 * ไม่กรอง releasedAt (P2-R19.6): ใบที่ยังมีผลมีแต่รายการที่ยังมีผล · ใบ VOIDED ยังแสดงรายการที่เคยจ่าย/หัก ·
 * เรียง PAY ก่อน แล้วตามงวด / วันที่สร้างของค่าคอม
 */
export const PAYROLL_COMMISSION_ITEMS_INCLUDE = {
  orderBy: [{ kind: 'asc' }, { salesCommission: { period: 'asc' } }, { salesCommission: { createdAt: 'asc' } }, { salesCommissionId: 'asc' }],
  include: {
    salesCommission: {
      select: {
        id: true,
        period: true,
        commissionAmount: true,
        status: true,
        clawbackReason: true,
        clawbackAt: true,
        createdAt: true,
        contract: { select: { contractNumber: true } },
        sale: { select: { saleNumber: true } },
      },
    },
  },
} satisfies Prisma.PayrollLine$commissionItemsArgs;

/**
 * ปล่อยรายการค่าคอมที่ยังมีผลทุกตัวของใบ (ทั้ง PAY และ CLAWBACK) — ลบร่าง (`softDelete`) และขั้นสุดท้ายของกลับรายการ (P2-R13)
 * ผู้เรียกถือ `post:${documentId}` อยู่แล้ว · คืน id ของรายการที่ปล่อย (เรียง id) ให้ audit `releasedCommissionItemIds`
 */
export async function releaseCommissionItems(tx: Prisma.TransactionClient, documentId: string, now: Date): Promise<string[]> {
  const items = await tx.payrollCommissionItem.findMany({
    where: { releasedAt: null, payrollLine: { payroll: { documentId } } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const ids = items.map((i) => i.id);
  if (ids.length > 0) await tx.payrollCommissionItem.updateMany({ where: { id: { in: ids }, releasedAt: null }, data: { releasedAt: now } });
  return ids;
}

/**
 * ย้อนการจ่ายค่าคอมของรายการ PAY ในใบเงินเดือนที่ลงบัญชีแล้ว (กลับรายการใบ · ล้างใบเงินเดือนด้วย CLI) — CAS ตามสถานะ
 * - PAID → APPROVED (ล้าง paidAt / paidAmount) — จ่ายได้อีกในใบถัดไป ไม่ว่าสัญญาจะเป็นสถานะไหน (P2-R5)
 * - CLAWED_BACK ที่มี paidAt → ล้าง paidAt / paidAmount / clawbackAmount — ไม่เคยจ่าย = เรียกคืน 100% ไม่มียอดให้หัก
 *   (ตรงกับที่ `clawbackAmountOf` เขียนให้แถวที่ไม่เคยจ่าย) · ผู้เรียกตรวจแล้วว่าไม่มีรายการ CLAWBACK ในใบที่ลงบัญชีแล้ว
 * - `partial: 'unpay'` (CLI ล้างใบเงินเดือนเท่านั้น — ใบที่หักคืนถูกล้างไปพร้อมกัน): PARTIALLY_CLAWED_BACK ที่มี paidAt →
 *   ล้าง paidAt / paidAmount คง clawbackAmount (ยอดเดียวกับที่ helper เขียนให้แถวที่ไม่เคยจ่าย: paidAmount = commissionAmount)
 *   · ทางกลับรายการปฏิเสธสถานะนี้ก่อนถึงที่นี่ (VOID_PARTIAL_CLAWBACK)
 * - สถานะอื่น: ไม่แตะ · CAS ได้ ≠ 1 แถว = แถวเปลี่ยนระหว่างนั้น → 409 (ไม่ข้ามเงียบ)
 */
export async function revertCommissionPayment(
  tx: Prisma.TransactionClient,
  c: { id: string; status: CommissionStatus; paidAt: Date | null },
  opts: { partial?: 'unpay' } = {},
): Promise<boolean> {
  let count: number;
  if (c.status === 'PAID') {
    ({ count } = await tx.salesCommission.updateMany({
      where: { id: c.id, status: 'PAID' },
      data: { status: 'APPROVED', paidAt: null, paidAmount: null },
    }));
  } else if (c.status === 'CLAWED_BACK' && c.paidAt !== null) {
    ({ count } = await tx.salesCommission.updateMany({
      where: { id: c.id, status: 'CLAWED_BACK', paidAt: { not: null } },
      data: { paidAt: null, paidAmount: null, clawbackAmount: null },
    }));
  } else if (c.status === 'PARTIALLY_CLAWED_BACK' && c.paidAt !== null && opts.partial === 'unpay') {
    ({ count } = await tx.salesCommission.updateMany({
      where: { id: c.id, status: 'PARTIALLY_CLAWED_BACK', paidAt: { not: null } },
      data: { paidAt: null, paidAmount: null },
    }));
  } else {
    return false;
  }
  if (count !== 1) throw new ConflictException(STATUS_CHANGED_MSG);
  return true;
}
