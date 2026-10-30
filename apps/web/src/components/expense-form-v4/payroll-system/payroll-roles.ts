/**
 * ใครทำใบเงินเดือนได้ — คำตัดสินเจ้าของ 2026-10-28 ("ไม่ให้ผู้จัดการสาขาทำ ปิดเมนูเงินเดือน").
 * ตรงกับ `apps/api/src/modules/expense-documents/payroll-roles.ts` (server ตรวจซ้ำทุกทาง).
 * ผู้จัดการสาขายังเปิดดูใบ/พิมพ์สลิปของสาขาตัวเองได้.
 */
export const PAYROLL_MANAGER_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] as const;

export const canManagePayroll = (role: string | null | undefined): boolean =>
  !!role && (PAYROLL_MANAGER_ROLES as readonly string[]).includes(role);

export const PAYROLL_ROLE_NOTICE = 'ใบเงินเดือนทำได้เฉพาะเจ้าของ ฝ่ายบัญชี และผู้จัดการการเงิน';
