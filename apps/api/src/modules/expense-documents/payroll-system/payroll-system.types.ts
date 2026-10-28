import type { MonthSummary } from '../../attendance/attendance-rules';

/**
 * Payroll D4 — รูปข้อมูลของแถวระบบที่ `PayrollSystemRowsService.compute` คืน
 * ส่วนที่ 1: OT / ทำงานวันหยุด / OT วันหยุด จากการลงเวลา · ส่วนที่ 2: ค่าคอม (PAY) + หักคืนค่าคอม (CLAWBACK) ฝั่ง SHOP
 * เงิน/ชั่วโมง/อัตราเป็นสตริงทศนิยม (คิดด้วย Prisma.Decimal เท่านั้น)
 */

/**
 * แหล่งของแถวรายได้ที่ระบบคิดจากการลงเวลา — ใบที่ถือแถวพวกนี้ = "ถือ OT เดือนนั้นของคนนั้นแล้ว"
 * ห้ามเติม COMMISSION: ค่าคอมไม่ทำให้ใบ "ถือ OT" และด่าน stale ของลงเวลาเทียบเฉพาะชุดนี้
 */
export const ATTENDANCE_INCOME_SOURCES = ['ATTENDANCE_OT', 'ATTENDANCE_HOLIDAY', 'ATTENDANCE_HOLIDAY_OT'] as const;

/** role ของบัญชีค่าคอม — มีเฉพาะฝั่ง SHOP (ไม่มี role ฝั่ง FINANCE: ใบ FINANCE ไม่ดึงค่าคอม) */
export const SHOP_COMMISSION_ROLE = 'shop_payroll_commission';

export interface SystemRowsQuery {
  branchId: string;
  entityScope: 'SHOP' | 'FINANCE';
  payrollPeriod: string;
  userIds: string[];
  excludeDocumentId?: string;
  now: Date;
}

/**
 * แถวลงเวลาเติม quantity/rate/multiplier เสมอ · แถว COMMISSION ปล่อย null — ผู้อ่านทุกตัว (ตาราง สลิป diff) ต้องรับ null
 * COMMISSION: หนึ่งแถวต่อคน · บัญชี = `shop_payroll_commission` ปัจจุบัน · ชื่อ `ค่าคอมมิชชัน ({n} รายการ)` (n = รายการ PAY) ·
 * ยอด = Σ รายการ PAY (> 0 เสมอ — ไม่มีแถวยอด 0) · ค่าคอมเป็นค่าจ้าง ⇒ เสียภาษีเสมอ
 */
export interface SystemIncomeRow {
  source: 'ATTENDANCE_OT' | 'ATTENDANCE_HOLIDAY' | 'ATTENDANCE_HOLIDAY_OT' | 'COMMISSION';
  accountCode: string;
  name: string;
  quantity: string | null;
  rate: string | null;
  multiplier: string | null;
  amount: string;
  isTaxable: true;
}

/**
 * รายการหักที่ระบบคิด — หักคืนค่าคอมที่จ่ายผ่านใบเงินเดือนที่ลงบัญชีแล้วแต่ถูกเรียกคืน
 * หนึ่งแถวต่อบัญชีของรายการ PAY ที่จ่ายไป (Cr บัญชีนั้น ไม่ใช่ role ปัจจุบัน) · ชื่อ `หักคืนค่าคอม ({n} รายการ)`
 * (n = รายการ CLAWBACK บนบัญชีนั้น) · ยอด > 0 เสมอ · เรียงตามรหัสบัญชี
 */
export interface SystemDeductionRow {
  source: 'COMMISSION_CLAWBACK';
  accountCode: string;
  name: string;
  amount: string;
}

/**
 * หนึ่งค่าคอมที่บรรทัดนี้จ่าย (PAY) หรือหักคืน (CLAWBACK) — Task 4 เก็บเป็น `PayrollCommissionItem`
 * (เก็บ salesCommissionId / kind / accountCode / amount; ช่องที่เหลือเป็นข้อมูลแสดงผล + diff ไม่ได้เก็บ)
 * - PAY: accountCode = role ปัจจุบัน · amount = commissionAmount · date = ISO `createdAt` · reason / carriedForward = null
 * - CLAWBACK: accountCode = บัญชีของรายการ PAY ที่ลงบัญชีแล้ว · amount = ยอดที่หักงวดนี้ (> 0) · date = ISO `clawbackAt` ·
 *   reason = `clawbackReason` · carriedForward = ส่วนที่ยกไปงวดหน้า (ทศนิยม 2 ตำแหน่ง) หรือ null เมื่อหักครบ
 * - reference = เลขสัญญา ?? เลขใบขาย ?? id ของค่าคอม
 * ลำดับ: PAY ตาม [period, createdAt, id] แล้ว CLAWBACK ตาม [clawbackAt, id]
 */
export interface CommissionItemOut {
  salesCommissionId: string;
  kind: 'PAY' | 'CLAWBACK';
  accountCode: string;
  amount: string;
  reference: string;
  date: string;
  reason: string | null;
  carriedForward: string | null;
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
  /** ไม่มีรหัสตอกบัตร และเดือนนี้ไม่มีวันที่ตอกเข้า (R23 — แถววางแผนวันหยุด/ลาไม่นับ) */
  | { code: 'NO_PIN' }
  /** ระบบคิด OT ให้ (รายเดือน + เงินเดือนทะเบียน) และมีรหัสตอกบัตร แต่เดือนนี้ไม่มีวันที่ตอกเข้า (เช่น สาขาไม่มีเครื่อง) — R20/R23 */
  | { code: 'NO_ATTENDANCE' }
  | { code: 'NOT_YET_CLOSABLE'; closableAt: string }
  /** ใบ FINANCE — พนักงานมีค่าคอมที่จ่ายได้ {count} รายการ แต่ใบฝั่งนี้ไม่ดึง (เฉพาะ count > 0) */
  | { code: 'COMMISSION_FINANCE_BLOCKED'; count: number }
  /** ค่าคอม {count} รายการมีรายการ PAY ที่ยังมีผลอยู่ในใบอื่น — หนึ่งคำเตือนต่อใบ (เป็นคำเตือน ไม่ใช่ 409) */
  | { code: 'COMMISSION_IN_OTHER_DOCUMENT'; count: number; documentId: string; documentNumber: string }
  /** หนึ่งคำเตือนต่อบรรทัด เฉพาะเมื่อ carried > 0 — หักได้ไม่เกินค่าคอมงวดนี้ ส่วนที่เหลือยกไปงวดหน้า */
  | { code: 'CLAWBACK_CARRIED'; deducted: string; carried: string }
  /** ค่าคอมที่จ่ายแล้ว (paidAt) ถูกเรียกคืน แต่ไม่มีรายการ PAY ในใบเงินเดือนที่ลงบัญชีแล้ว — ระบบไม่หักให้ */
  | { code: 'CLAWBACK_PAID_OUTSIDE_PAYROLL'; reference: string };

export interface AttendanceSummarySnapshot extends Omit<MonthSummary, 'otHours'> {
  /** OT วันทำงาน (WORK + LEAVE_* ที่มีการตอก) */
  otHours: string;
  holidayHours: string;
  holidayOtHours: string;
  holidayWorkedDays: number;
  reviewCount: number;
  /** รายเดือน + มีเงินเดือนในทะเบียน — ระบบคิด OT ให้ (คำตัดสิน R1: Task 4 เก็บผลนี้ตรง ๆ และเว็บอ่าน) */
  autoOtEligible: boolean;
  /** เดือนนี้มีวันที่ตอกเข้า (`clockIn`) อย่างน้อย 1 วัน (ทุกสาขา) — R20/R23: กติกาแถว OT ที่กรอกเองซ้ำใช้เฉพาะเมื่อ autoOtEligible && attendanceTracked */
  attendanceTracked: boolean;
}

export interface SystemNotes {
  review: ReviewDay[];
  warnings: SystemWarning[];
}

export interface SystemRowsForUser {
  userId: string;
  autoOtEligible: boolean;
  /** เดือนนี้มีวันที่ตอกเข้า (ในชุดวันที่ใช้คิดชั่วโมง) — ไม่มี = ระบบไม่คิด OT ให้ แถวที่กรอกเองรับเป็น MANUAL (R20 · R23: แถววางแผนอย่างเดียวไม่นับ) */
  attendanceTracked: boolean;
  /** แถวลงเวลา (ตามเกณฑ์ OT) แล้วตามด้วยแถว COMMISSION (ทุกบรรทัด SHOP ไม่ขึ้นกับเกณฑ์ OT / ใบอื่นถือ OT / รหัสตอกบัตร) */
  systemIncome: SystemIncomeRow[];
  /** หักคืนค่าคอม (SHOP เท่านั้น — FINANCE เป็น [] เสมอ) */
  systemDeductions: SystemDeductionRow[];
  /** รายการค่าคอมที่บรรทัดนี้จ่าย/หักคืน (SHOP เท่านั้น — FINANCE เป็น [] เสมอ) */
  commissionItems: CommissionItemOut[];
  attendanceSummary: AttendanceSummarySnapshot;
  notes: SystemNotes;
}

export interface SystemRowsResult {
  /** รหัสบัญชีของแถวลงเวลาในฝั่งนี้ (ไม่ซ้ำ) — Task 4 ใช้กันแถว OT ที่กรอกเองซ้ำ */
  attendanceAccountCodes: string[];
  /**
   * P2-R7 — บัญชีที่ถือว่าเป็น "บัญชีค่าคอม" ของการคิดครั้งนี้ (ไม่ซ้ำ): รหัสปัจจุบันของ `shop_payroll_commission` + บัญชีของทุกแถว
   * COMMISSION_CLAWBACK ที่คิดได้ · Task 4 ปฏิเสธรายการหัก MANUAL บนบัญชีเหล่านี้ในบรรทัดที่มีแถวหักคืน (CLAWBACK_DUPLICATE) ·
   * FINANCE = [] (ไม่มี role ค่าคอมฝั่งนี้)
   */
  commissionAccountCodes: string[];
  rows: SystemRowsForUser[];
}
