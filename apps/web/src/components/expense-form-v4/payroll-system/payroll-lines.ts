import {
  newPayrollCustomDeduction,
  newPayrollCustomIncome,
  newPayrollLine,
  type PayrollAttendanceSummary,
  type PayrollLineForm,
  type PayrollSystemIncomeRow,
  type PayrollSystemNotes,
} from '../types';

/**
 * Payroll D4 ส่วนที่ 1 — บรรทัดใบเงินเดือน ↔ API: โหลดใบที่เก็บไว้เข้าฟอร์ม, คัดลอกงวดก่อน, เอาแถว OT ที่กรอกเองออก
 * และ payload ตอนบันทึก. server คิดแถวระบบ (ATTENDANCE_*) ใหม่ทุกครั้งที่บันทึก ⇒ ฟอร์มส่งเฉพาะแถวที่คนกรอก
 */

/** แถวรายได้ตามที่ `GET /expense-documents/:id` คืน (Decimal เป็นสตริง) */
export interface StoredPayrollIncome {
  accountCode: string;
  name: string;
  amount: string;
  isTaxable: boolean;
  source?: string;
  quantity?: string | null;
  rate?: string | null;
  multiplier?: string | null;
}

export interface StoredPayrollLine {
  userId: string | null;
  employeeName: string;
  baseSalary: string;
  ssoEmployee: string;
  whtAmount: string;
  customIncome?: StoredPayrollIncome[];
  customDeduction?: Array<{ accountCode: string; name: string; amount: string }>;
  attendanceSummary?: PayrollAttendanceSummary | null;
  systemNotes?: PayrollSystemNotes | null;
}

export const STRIP_TYPED_OT_TOAST = 'เอาแถว OT ที่กรอกเองออก — ระบบคิดจากลงเวลาให้แล้ว';

// แถวไม่มี source = ข้อมูลก่อน D4 (กรอกเองทั้งหมด)
const sourceOf = (r: StoredPayrollIncome) => r.source ?? 'MANUAL';
/** แถวที่คนกรอก — ส่งกลับตอนบันทึก · แหล่งอื่นทั้งหมด (ATTENDANCE_* และแหล่งระบบในอนาคต) server คิดใหม่เอง (R6) */
const isTypedIncome = (r: StoredPayrollIncome) => ['MANUAL', 'ADJUSTMENT'].includes(sourceOf(r));
const amountText = (v: string) => String(parseFloat(v));

function lineBase(l: StoredPayrollLine, overrides: Partial<PayrollLineForm>): PayrollLineForm {
  return newPayrollLine({
    userId: l.userId ?? '',
    employeeName: l.employeeName,
    // เลขบัตรอ่านจากทะเบียนใหม่ทุกครั้งที่บันทึก (ค่าที่ได้จาก API อาจถูก mask)
    employeeTaxId: '',
    baseSalary: amountText(l.baseSalary),
    ssoEmployee: amountText(l.ssoEmployee),
    whtAmount: amountText(l.whtAmount),
    customDeduction: (l.customDeduction ?? []).map((r) =>
      newPayrollCustomDeduction({ accountCode: r.accountCode, name: r.name, amount: amountText(r.amount) }),
    ),
    ...overrides,
  });
}

const typedRow = (r: StoredPayrollIncome) =>
  newPayrollCustomIncome({
    accountCode: r.accountCode,
    name: r.name,
    amount: amountText(r.amount),
    isTaxable: r.isTaxable,
    isAdjustment: sourceOf(r) === 'ADJUSTMENT',
  });

const systemRow = (r: StoredPayrollIncome): PayrollSystemIncomeRow => ({
  source: sourceOf(r),
  accountCode: r.accountCode,
  name: r.name,
  quantity: r.quantity ?? null,
  rate: r.rate ?? null,
  multiplier: r.multiplier ?? null,
  amount: r.amount,
});

/** แก้ไขใบ: แถวที่คนกรอกกลับเข้าตารางกรอกเอง (รายการปรับปรุงงวดก่อนคงติ๊ก) · แถวระบบ/สรุปลงเวลา/วันที่ต้องตรวจ แสดงอ่านอย่างเดียว */
export function formLineFromStored(l: StoredPayrollLine): PayrollLineForm {
  const income = l.customIncome ?? [];
  return lineBase(l, {
    customIncome: income.filter(isTypedIncome).map(typedRow),
    systemIncome: income.filter((r) => !isTypedIncome(r)).map(systemRow),
    attendanceSummary: l.attendanceSummary ?? null,
    systemNotes: l.systemNotes ?? null,
  });
}

/**
 * คัดลอกงวดก่อน: เฉพาะแถวที่กรอกเอง (MANUAL) — ไม่เอาแถวระบบ (คิดใหม่ตอนบันทึก) และไม่เอารายการปรับปรุงงวดก่อน
 * (แก้เฉพาะงวดนั้น) · บรรทัดที่ได้ยังไม่เคยบันทึกในใบนี้ ⇒ ไม่มีสรุปลงเวลา (แถว OT ที่ติดมาให้ server ตัดสิน)
 */
export function copiedLineFromStored(l: StoredPayrollLine): PayrollLineForm {
  return lineBase(l, {
    customIncome: (l.customIncome ?? []).filter((r) => sourceOf(r) === 'MANUAL').map(typedRow),
  });
}

/**
 * แถวระบบ / สรุปลงเวลา / วันที่ต้องตรวจที่เก็บไว้ ผูกกับ (คน, งวด, ฝั่ง) ตอนบันทึกครั้งล่าสุด ⇒ เปลี่ยนคน งวด หรือฝั่งแล้ว
 * ใช้ไม่ได้อีก — ล้างทิ้ง แล้วให้ server คิดใหม่ตอนบันทึก (บรรทัดกลายเป็น "ยังไม่เคยบันทึก" สำหรับกติกาเอาแถว OT ออกด้วย)
 */
export const withoutStoredSystemData = (l: PayrollLineForm): PayrollLineForm => ({
  ...l,
  systemIncome: [],
  attendanceSummary: null,
  systemNotes: null,
});

/**
 * ก่อนบันทึก: บรรทัดที่บันทึกแล้ว ระบบคิด OT ให้ และเดือนนั้นมีข้อมูลลงเวลา (`attendanceSummary.autoOtEligible` +
 * `attendanceTracked` ที่เก็บไว้ — กติกาเดียวกับ server R20) ห้ามมีแถว OT ที่กรอกเอง (server ปฏิเสธ MANUAL_OT_DUPLICATE)
 * ⇒ เอาแถวรหัสบัญชีลงเวลาที่ไม่ได้ติ๊ก "รายการปรับปรุงงวดก่อน" ออก · บรรทัดใหม่/ยังไม่เคยบันทึก/ไม่มีข้อมูลลงเวลา/
 * บันทึกก่อนมี `attendanceTracked` ไม่แตะ — ให้ server ตัดสินจากลงเวลาปัจจุบัน (server คิดใหม่ทุกครั้งที่บันทึก)
 */
export function stripTypedOtRows(
  lines: PayrollLineForm[],
  attendanceAccountCodes: string[],
): { lines: PayrollLineForm[]; removed: number } {
  const codes = new Set(attendanceAccountCodes);
  let removed = 0;
  const next = lines.map((l) => {
    if (l.attendanceSummary?.autoOtEligible !== true || l.attendanceSummary.attendanceTracked !== true) return l;
    const kept = l.customIncome.filter((r) => r.isAdjustment || !codes.has(r.accountCode));
    removed += l.customIncome.length - kept.length;
    return kept.length === l.customIncome.length ? l : { ...l, customIncome: kept };
  });
  return { lines: next, removed };
}

/** บรรทัดที่ส่ง POST/PATCH — แถวรายได้เฉพาะที่คนกรอก (แถวระบบอยู่ใน `systemIncome` ซึ่งไม่ส่ง) */
export function payrollLinesPayload(lines: PayrollLineForm[]) {
  return lines
    .filter((l) => l.employeeName && parseFloat(l.baseSalary) > 0)
    .map((l) => {
      const income = l.customIncome.filter((r) => r.accountCode && parseFloat(r.amount) > 0);
      const deduction = l.customDeduction.filter((r) => r.accountCode && parseFloat(r.amount) > 0);
      return {
        userId: l.userId || undefined,
        employeeName: l.employeeName,
        employeeTaxId: l.employeeTaxId || undefined,
        baseSalary: parseFloat(l.baseSalary),
        ssoEmployee: parseFloat(l.ssoEmployee) || 0,
        whtAmount: parseFloat(l.whtAmount) || 0,
        customIncome:
          income.length > 0
            ? income.map((r) => ({
                accountCode: r.accountCode,
                name: r.name || r.accountCode,
                amount: parseFloat(r.amount),
                isTaxable: r.isTaxable,
                ...(r.isAdjustment ? { isAdjustment: true } : {}),
              }))
            : undefined,
        customDeduction:
          deduction.length > 0
            ? deduction.map((r) => ({
                accountCode: r.accountCode,
                name: r.name || r.accountCode,
                amount: parseFloat(r.amount),
              }))
            : undefined,
      };
    });
}
