import type { PayrollStaleDiff } from '../types';

/**
 * Payroll D4 ส่วนที่ 1 — สถานะใบเงินเดือนที่ยังแก้ได้ + 409 ของด่านใบเงินเดือน
 * ใช้ร่วมกัน: ฟอร์ม (ExpenseFormV4) · หน้ารายการ (ExpensesPage) · หน้ารายละเอียด (ExpenseDetailPage)
 */

/** คำตัดสิน 6 — ใบที่ยังไม่ลงบัญชีแก้ได้ (บันทึกแล้ว server ตั้งกลับเป็นร่าง) · ชุดเดียวกับที่ server มี `payrollGate` */
export const PAYROLL_EDITABLE_STATUSES: readonly string[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];

export const isPayrollEditable = (doc: { documentType: string; status: string }) =>
  doc.documentType === 'PAYROLL' && PAYROLL_EDITABLE_STATUSES.includes(doc.status);

/** ปลายทางของปุ่ม/เมนู "แก้ไข" ใบเงินเดือน (ฟอร์มสร้างเอกสาร โหมดแก้ไข) */
export const payrollEditPath = (id: string) => `/expenses/new?edit=${id}`;

/** 409 ของด่านใบเงินเดือน — `message` ของ server มีวันที่/ชื่อครบแล้ว แสดงตามนั้น ห้ามจัดรูปใหม่ */
export interface PayrollConflict {
  code: string;
  message: string;
  /** เฉพาะ `PAYROLL_STALE` */
  diffs?: PayrollStaleDiff[];
}

/** อ่าน 409 `PAYROLL_*` จาก error ของ axios (รูปที่ SentryExceptionFilter ส่ง) · อย่างอื่น = null */
export function payrollConflictOf(err: unknown): PayrollConflict | null {
  const res = (err as { response?: { status?: number; data?: Record<string, unknown> } } | null)?.response;
  const code = res?.data?.code;
  if (res?.status !== 409 || typeof code !== 'string' || !code.startsWith('PAYROLL_')) return null;
  const message = typeof res.data?.message === 'string' ? res.data.message : '';
  const diffs = Array.isArray(res.data?.diffs) ? (res.data.diffs as PayrollStaleDiff[]) : undefined;
  return { code, message, ...(diffs ? { diffs } : {}) };
}
