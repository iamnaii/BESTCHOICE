import type { MonthSummary } from '../../attendance/attendance-rules';

/**
 * Payroll D4 ส่วนที่ 1 — รูปข้อมูลของแถวระบบ (OT / ทำงานวันหยุด / OT วันหยุด จากการลงเวลา)
 * ที่ `PayrollSystemRowsService.compute` คืน · เงิน/ชั่วโมง/อัตราเป็นสตริงทศนิยม (คิดด้วย Prisma.Decimal เท่านั้น)
 */

/** แหล่งของแถวรายได้ที่ระบบคิดจากการลงเวลา — ใบที่ถือแถวพวกนี้ = "ถือ OT เดือนนั้นของคนนั้นแล้ว" */
export const ATTENDANCE_INCOME_SOURCES = ['ATTENDANCE_OT', 'ATTENDANCE_HOLIDAY', 'ATTENDANCE_HOLIDAY_OT'] as const;

export interface SystemRowsQuery {
  branchId: string;
  entityScope: 'SHOP' | 'FINANCE';
  payrollPeriod: string;
  userIds: string[];
  excludeDocumentId?: string;
  now: Date;
}

/** แถวลงเวลาเติม quantity/rate/multiplier เสมอ · แถว COMMISSION ของส่วนที่ 2 ปล่อย null — ผู้อ่านทุกตัว (ตาราง สลิป diff) ต้องรับ null */
export interface SystemIncomeRow {
  source: 'ATTENDANCE_OT' | 'ATTENDANCE_HOLIDAY' | 'ATTENDANCE_HOLIDAY_OT';
  accountCode: string;
  name: string;
  quantity: string | null;
  rate: string | null;
  multiplier: string | null;
  amount: string;
  isTaxable: true;
}

export interface StaleDiff {
  userId: string;
  employeeName: string;
  label: string;
  stored: { amount: string; hours: string | null };
  current: { amount: string; hours: string | null };
}

export interface ReviewDay {
  dayId: string;
  /** 'YYYY-MM-DD' วันไทย */
  date: string;
  branchId: string;
  /** เฉพาะธงที่ต้องตรวจ (ไม่ใช่ธงทั้งหมดของวัน) */
  flags: string[];
  /** DEVICE_CONFLICT = อนุมัติไม่ได้จนกว่าเจ้าของล้างธง */
  blocking: boolean;
}

export type SystemWarning =
  | { code: 'NOT_MONTHLY_OR_NO_BASE'; otHours: string }
  | { code: 'IN_OTHER_DOCUMENT'; documentId: string; documentNumber: string; branchName: string; status: string }
  /** ไม่มีรหัสตอกบัตร และเดือนนี้ไม่มีแถวลงเวลาเลย */
  | { code: 'NO_PIN' }
  /** ระบบคิด OT ให้ (รายเดือน + เงินเดือนทะเบียน) และมีรหัสตอกบัตร แต่เดือนนี้ไม่มีแถวลงเวลาเลย (เช่น สาขาไม่มีเครื่อง) — R20 */
  | { code: 'NO_ATTENDANCE' }
  | { code: 'NOT_YET_CLOSABLE'; closableAt: string };

export interface AttendanceSummarySnapshot extends Omit<MonthSummary, 'otHours'> {
  /** OT วันทำงาน (WORK + LEAVE_* ที่มีการตอก) */
  otHours: string;
  holidayHours: string;
  holidayOtHours: string;
  holidayWorkedDays: number;
  reviewCount: number;
  /** รายเดือน + มีเงินเดือนในทะเบียน — ระบบคิด OT ให้ (คำตัดสิน R1: Task 4 เก็บผลนี้ตรง ๆ และเว็บอ่าน) */
  autoOtEligible: boolean;
  /** เดือนนี้มีแถวลงเวลาของคนนี้อย่างน้อย 1 แถว (ทุกสาขา) — R20: กติกาแถว OT ที่กรอกเองซ้ำใช้เฉพาะเมื่อ autoOtEligible && attendanceTracked */
  attendanceTracked: boolean;
}

export interface SystemNotes {
  review: ReviewDay[];
  warnings: SystemWarning[];
}

export interface SystemRowsForUser {
  userId: string;
  autoOtEligible: boolean;
  /** เดือนนี้มีแถวลงเวลาของคนนี้ (ชุดวันเดียวกับที่ใช้คิดชั่วโมง) — ไม่มี = ระบบไม่คิด OT ให้ แถวที่กรอกเองรับเป็น MANUAL (R20) */
  attendanceTracked: boolean;
  systemIncome: SystemIncomeRow[];
  attendanceSummary: AttendanceSummarySnapshot;
  notes: SystemNotes;
}

export interface SystemRowsResult {
  /** รหัสบัญชีของแถวลงเวลาในฝั่งนี้ (ไม่ซ้ำ) — Task 4 ใช้กันแถว OT ที่กรอกเองซ้ำ */
  attendanceAccountCodes: string[];
  rows: SystemRowsForUser[];
}
