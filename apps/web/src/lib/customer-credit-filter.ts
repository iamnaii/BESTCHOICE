/**
 * ตัวกรอง "สถานะเครดิต" บนหน้ารายชื่อลูกค้าอ่านจาก 2 ฟิลด์ที่เป็นคนละ enum:
 *
 *   `customer:` → `Customer.creditCheckStatus`  (CustomerCreditCheckStatus:
 *                  NONE / PRE_CHECK_PASSED / FULL_CHECK_PASSED / REJECTED / UNDER_REVIEW)
 *   `check:`    → ใบตรวจล่าสุด `CreditCheck.status` (CreditCheckStatus:
 *                  PENDING / APPROVED / REJECTED / MANUAL_REVIEW)
 *
 * ค่าใน <Select> จึงพก prefix มาด้วย แล้วแตกตอนประกอบ query string.
 *
 * ที่ต้องแยก: เดิมทุกตัวเลือกถูกส่งเข้า param `creditCheckStatus` ตัวเดียว ⇒ APPROVED /
 * PENDING / MANUAL_REVIEW (สมาชิกของ CreditCheckStatus ไม่ใช่ CustomerCreditCheckStatus)
 * ไปชน enum ผิดตัว แล้ว Prisma โยน validation error = HTTP 500 — ทั้งที่ param ที่ถูกต้อง
 * (`creditStatus`) มีอยู่ใน API อยู่แล้วแต่ frontend ไม่เคยส่ง
 * (ยืนยันระดับ DB: `select 'APPROVED'::"CustomerCreditCheckStatus"` → invalid input value)
 */

export interface CreditFilterOption {
  value: string;
  label: string;
}

/** สถานะบนตัวลูกค้า — ผลสรุปล่าสุดของการเช็คเครดิต */
export const CUSTOMER_CREDIT_OPTIONS: CreditFilterOption[] = [
  { value: 'customer:UNDER_REVIEW', label: 'รอผู้จัดการตรวจ' },
  { value: 'customer:PRE_CHECK_PASSED', label: 'ผ่าน pre-check' },
  { value: 'customer:FULL_CHECK_PASSED', label: 'ผ่านเต็ม' },
  { value: 'customer:REJECTED', label: 'ไม่ผ่าน' },
  { value: 'customer:NONE', label: 'ยังไม่เคยตรวจ' },
];

/** สถานะของ "ใบตรวจ" ล่าสุด — คนละชั้นกับสถานะบนตัวลูกค้า */
export const CREDIT_CHECK_OPTIONS: CreditFilterOption[] = [
  { value: 'check:PENDING', label: 'รอตรวจ' },
  { value: 'check:APPROVED', label: 'ผ่าน' },
  { value: 'check:MANUAL_REVIEW', label: 'รอตรวจสอบด้วยตนเอง' },
  { value: 'check:REJECTED', label: 'ไม่ผ่าน' },
];

/**
 * แปลงค่าจาก <Select> เป็น query param ที่ตรงฟิลด์.
 * ใช้ร่วมกันทั้ง query ของตารางและปุ่มส่งออก Excel — กันสองที่กรองไม่ตรงกัน.
 */
export function applyCreditFilter(params: Record<string, string>, filter: string): void {
  const [scope, value] = filter.split(':');
  // ค่าที่ไม่มี prefix = ค่าเก่าค้างใน state/URL — ไม่กรองเลยดีกว่ายิง enum ผิดแล้วได้ 500
  if (!value) return;
  if (scope === 'check') params.creditStatus = value;
  else if (scope === 'customer') params.creditCheckStatus = value;
}
