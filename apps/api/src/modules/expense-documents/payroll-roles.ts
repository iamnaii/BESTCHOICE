import { ForbiddenException } from '@nestjs/common';

/**
 * ใครทำใบเงินเดือนได้ (คำตัดสินเจ้าของ 2026-10-28: "ไม่ให้ผู้จัดการสาขาทำ ปิดเมนูเงินเดือน")
 * — สร้าง / แก้ / ส่งขออนุมัติ / อนุมัติ / ลงบัญชี / ยกเลิก / ลบ ใบ PAYROLL.
 * ผู้จัดการสาขายังเปิดดูใบของสาขาตัวเองได้ตามเดิม (branch scope ของ findOne).
 */
export const PAYROLL_MANAGER_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] as const;

export const PAYROLL_FORBIDDEN_MSG = 'ใบเงินเดือนทำได้เฉพาะเจ้าของ ฝ่ายบัญชี และผู้จัดการการเงิน';

export function assertPayrollActor(role: string | null | undefined): void {
  if (!role || !(PAYROLL_MANAGER_ROLES as readonly string[]).includes(role)) {
    throw new ForbiddenException(PAYROLL_FORBIDDEN_MSG);
  }
}
