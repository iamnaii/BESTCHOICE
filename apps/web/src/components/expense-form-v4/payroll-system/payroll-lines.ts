import {
  newPayrollCustomDeduction,
  newPayrollCustomIncome,
  newPayrollLine,
  type PayrollAttendanceSummary,
  type PayrollCommissionItemView,
  type PayrollLineForm,
  type PayrollSystemDeductionRow,
  type PayrollSystemIncomeRow,
  type PayrollSystemNotes,
} from '../types';

/**
 * Payroll D4 ส่วนที่ 1 — บรรทัดใบเงินเดือน ↔ API: โหลดใบที่เก็บไว้เข้าฟอร์ม, คัดลอกงวดก่อน, เอาแถว OT ที่กรอกเองออก
 * และ payload ตอนบันทึก. server คิดแถวระบบ (ATTENDANCE_*) ใหม่ทุกครั้งที่บันทึก ⇒ ฟอร์มส่งเฉพาะแถวที่คนกรอก
 * ส่วนที่ 2 — แถว COMMISSION (รายได้) + COMMISSION_CLAWBACK (รายการหัก) + รายการค่าคอม ก็เป็นของ server: แสดงอ่านอย่างเดียว
 * ไม่ส่งกลับ (P2-R3 / P2-R19.1) — ส่งรายการหักที่ server คืนกลับไปเป็น MANUAL = 400 PAYROLL_CLAWBACK_DUPLICATE หรือหักซ้ำ
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

/** แถวรายการหักที่เก็บไว้ — `source` ไม่มี = ข้อมูลก่อน D4 ส่วนที่ 2 (กรอกเองทั้งหมด) */
export interface StoredPayrollDeduction {
  accountCode: string;
  name: string;
  amount: string;
  /** MANUAL | COMMISSION_CLAWBACK */
  source?: string;
}

/**
 * รายการค่าคอมของบรรทัดตามที่ `GET /expense-documents/:id` คืน (`PAYROLL_COMMISSION_ITEMS_INCLUDE` ฝั่ง server) —
 * ไม่กรอง releasedAt (P2-R19.6): ใบ VOIDED ยังเห็นรายการที่เคยจ่าย/หัก
 */
export interface StoredCommissionItem {
  id: string;
  salesCommissionId: string;
  kind: 'PAY' | 'CLAWBACK';
  accountCode: string;
  amount: string;
  releasedAt: string | null;
  salesCommission: {
    id: string;
    period: string;
    commissionAmount: string;
    status: string;
    clawbackReason: string | null;
    clawbackAt: string | null;
    createdAt: string;
    contract: { contractNumber: string } | null;
    sale: { saleNumber: string } | null;
  };
}

export interface StoredPayrollLine {
  userId: string | null;
  employeeName: string;
  baseSalary: string;
  ssoEmployee: string;
  whtAmount: string;
  customIncome?: StoredPayrollIncome[];
  customDeduction?: StoredPayrollDeduction[];
  commissionItems?: StoredCommissionItem[];
  attendanceSummary?: PayrollAttendanceSummary | null;
  systemNotes?: PayrollSystemNotes | null;
}

export const STRIP_TYPED_OT_TOAST = 'เอาแถว OT ที่กรอกเองออก — ระบบคิดจากลงเวลาให้แล้ว';

// แถวไม่มี source = ข้อมูลก่อน D4 (กรอกเองทั้งหมด)
const sourceOf = (r: StoredPayrollIncome) => r.source ?? 'MANUAL';
/** แถวที่คนกรอก — ส่งกลับตอนบันทึก · แหล่งอื่นทั้งหมด (ATTENDANCE_* และแหล่งระบบในอนาคต) server คิดใหม่เอง (R6) */
const isTypedIncome = (r: StoredPayrollIncome) => ['MANUAL', 'ADJUSTMENT'].includes(sourceOf(r));
const amountText = (v: string) => String(parseFloat(v));

// รายการหักไม่มี source = ข้อมูลก่อนส่วนที่ 2 (กรอกเองทั้งหมด) — กติกาเดียวกับ sourceOf ของรายได้
const deductionSourceOf = (r: StoredPayrollDeduction) => r.source ?? 'MANUAL';
/** P2-R3 ฝั่งเว็บ — เฉพาะรายการหักที่คนกรอกเข้าตารางแก้ไขได้ (และ payload) · แหล่งอื่นเป็นของ server */
const isTypedDeduction = (r: StoredPayrollDeduction) => deductionSourceOf(r) === 'MANUAL';

function lineBase(l: StoredPayrollLine, overrides: Partial<PayrollLineForm>): PayrollLineForm {
  return newPayrollLine({
    userId: l.userId ?? '',
    employeeName: l.employeeName,
    // เลขบัตรอ่านจากทะเบียนใหม่ทุกครั้งที่บันทึก (ค่าที่ได้จาก API อาจถูก mask)
    employeeTaxId: '',
    baseSalary: amountText(l.baseSalary),
    ssoEmployee: amountText(l.ssoEmployee),
    whtAmount: amountText(l.whtAmount),
    customDeduction: (l.customDeduction ?? []).filter(isTypedDeduction).map((r) =>
      newPayrollCustomDeduction({ accountCode: r.accountCode, name: r.name, amount: amountText(r.amount) }),
    ),
    ...overrides,
  });
}

const systemDeductionRow = (r: StoredPayrollDeduction): PayrollSystemDeductionRow => ({
  source: deductionSourceOf(r),
  accountCode: r.accountCode,
  name: r.name,
  amount: r.amount,
});

/**
 * รายการค่าคอมที่ยังมีผล → ข้อมูลแสดงผล (P2-R21) · รายการที่ปล่อยแล้ว (ใบกลับรายการ/ลบร่าง) = null
 * ใช้ทั้งฟอร์ม และสลิปเงินเดือน
 */
export function commissionItemView(i: StoredCommissionItem): PayrollCommissionItemView | null {
  if (i.releasedAt) return null;
  const sc = i.salesCommission;
  return {
    kind: i.kind,
    accountCode: i.accountCode,
    amount: i.amount,
    reference: sc.contract?.contractNumber ?? sc.sale?.saleNumber ?? sc.id,
    date: i.kind === 'PAY' ? sc.createdAt : sc.clawbackAt,
    period: sc.period,
    reason: i.kind === 'CLAWBACK' ? sc.clawbackReason : null,
  };
}

export const liveCommissionItems = (items: StoredCommissionItem[] | undefined): PayrollCommissionItemView[] =>
  (items ?? []).flatMap((i) => {
    const v = commissionItemView(i);
    return v ? [v] : [];
  });

/**
 * ยอดหักคืนค่าคอมของบรรทัด (คำเตือน `CLAWBACK_CARRIED` — server ส่งหนึ่งใบต่อบรรทัด เฉพาะเมื่อยกไป > 0; รวมให้ถ้ามีมากกว่าหนึ่ง)
 * ใช้ทั้งตารางหักในฟอร์ม หน้ารายละเอียด และสลิป
 */
export function clawbackCarriedOf(notes: PayrollSystemNotes | null | undefined): { deducted: string; carried: string } | null {
  const carried = (notes?.warnings ?? []).flatMap((w) => (w.code === 'CLAWBACK_CARRIED' ? [w] : []));
  if (carried.length === 0) return null;
  const cents = (v: string) => Math.round(parseFloat(v) * 100);
  const sum = (pick: (w: (typeof carried)[number]) => string) =>
    (carried.reduce((s, w) => s + cents(pick(w)), 0) / 100).toFixed(2);
  return { deducted: sum((w) => w.deducted), carried: sum((w) => w.carried) };
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
    systemDeductions: (l.customDeduction ?? []).filter((r) => !isTypedDeduction(r)).map(systemDeductionRow),
    commissionItems: liveCommissionItems(l.commissionItems),
    attendanceSummary: l.attendanceSummary ?? null,
    systemNotes: l.systemNotes ?? null,
  });
}

/**
 * คัดลอกงวดก่อน: เฉพาะแถวที่กรอกเอง (MANUAL) — ไม่เอาแถวระบบ (คิดใหม่ตอนบันทึก) และไม่เอารายการปรับปรุงงวดก่อน
 * (แก้เฉพาะงวดนั้น) · บรรทัดที่ได้ยังไม่เคยบันทึกในใบนี้ ⇒ ไม่มีสรุปลงเวลา (แถว OT ที่ติดมาให้ server ตัดสิน)
 * · ส่วนที่ 2: รายการหักเฉพาะ MANUAL (lineBase) — หักคืนค่าคอมและรายการค่าคอมเป็นของงวดเดิม ไม่คัดลอก
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
export const clearedSystemData = (): Pick<
  PayrollLineForm,
  'systemIncome' | 'systemDeductions' | 'commissionItems' | 'attendanceSummary' | 'systemNotes'
> => ({
  systemIncome: [],
  systemDeductions: [],
  commissionItems: [],
  attendanceSummary: null,
  systemNotes: null,
});

export const withoutStoredSystemData = (l: PayrollLineForm): PayrollLineForm => ({ ...l, ...clearedSystemData() });

/** แหล่งของรายการหักที่ลดฐานภาษี — ชุดเดียวกับ `payrollTaxableGross` ฝั่ง server (P2-R18: เฉพาะ COMMISSION_CLAWBACK) */
const TAX_REDUCING_DEDUCTION_SOURCES = ['COMMISSION_CLAWBACK'];

const num = (v: string | undefined) => parseFloat(v ?? '') || 0;
const sumAmounts = (rows: Array<{ amount: string }>) => rows.reduce((s, r) => s + num(r.amount), 0);

/**
 * ยอดของบรรทัดในฟอร์ม (ตัวเลขไว้ตรวจ — ยอดจริงคือที่ server คิดตอนบันทึก):
 * - รายได้พิเศษ = แถวระบบที่เก็บไว้ + แถวที่กรอกเอง · รายการหัก = ที่กรอกเอง + รายการหักจากระบบ (P2-R19.2)
 * - ฐาน WHT = max(0, ฐาน + แถวระบบ (เสียภาษีเสมอ) + รายได้กรอกเองที่เสียภาษี − หักคืนค่าคอม) — สูตรเดียวกับ
 *   `payrollTaxableGross` (payroll-pay.ts ฝั่ง server) ที่ ภ.ง.ด.1 ใช้ (P2-R18) · ไม่ import ไฟล์ server — เขียนซ้ำและปักด้วยเทส
 * - สุทธิ = max(0, ฐาน + รายได้พิเศษ − SSO − WHT − รายการหัก) — รายการหักรวมหัก ณ ที่จ่ายค่าคอม 3% (COMMISSION_WHT) แล้ว
 * - ฐานภาษีเงินเดือนที่แนะนำ (`salaryTaxableBase`) = ฐาน WHT ที่ไม่รวมค่าคอมและหักคืน — ค่าคอมหัก ณ ที่จ่าย 3% แยกแถว
 *   (คำตัดสินเจ้าของ 2026-10-29) ส่วน `taxableBase` ยังเป็นเงินได้ที่ยื่น ภ.ง.ด.1
 */
export function payrollLineTotals(l: PayrollLineForm) {
  const base = num(l.baseSalary);
  const sso = num(l.ssoEmployee);
  const wht = num(l.whtAmount);
  const systemIncome = sumAmounts(l.systemIncome ?? []);
  const income = systemIncome + sumAmounts(l.customIncome ?? []);
  const systemDeduction = sumAmounts(l.systemDeductions ?? []);
  const deduction = sumAmounts(l.customDeduction ?? []) + systemDeduction;
  const taxReducing = sumAmounts((l.systemDeductions ?? []).filter((r) => TAX_REDUCING_DEDUCTION_SOURCES.includes(r.source)));
  const taxableTyped = sumAmounts((l.customIncome ?? []).filter((r) => r.isTaxable));
  const commissionIncome = sumAmounts((l.systemIncome ?? []).filter((r) => r.source === 'COMMISSION'));
  const commissionWht = sumAmounts((l.systemDeductions ?? []).filter((r) => r.source === 'COMMISSION_WHT'));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    base,
    sso,
    wht,
    systemIncome,
    income,
    systemDeduction,
    deduction,
    clawback: taxReducing,
    commissionIncome,
    commissionWht,
    taxableBase: round2(Math.max(0, base + systemIncome + taxableTyped - taxReducing)),
    salaryTaxableBase: round2(Math.max(0, base + systemIncome - commissionIncome + taxableTyped)),
    netPaid: round2(Math.max(0, base + income - sso - wht - deduction)),
  };
}

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

/**
 * บรรทัดที่ส่ง POST/PATCH — แถวรายได้/รายการหักเฉพาะที่คนกรอก (แถวระบบอยู่ใน `systemIncome` / `systemDeductions` ·
 * รายการค่าคอมอยู่ใน `commissionItems` — ทั้งสามไม่ส่ง)
 */
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
