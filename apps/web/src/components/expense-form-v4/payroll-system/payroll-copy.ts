import { THAI_MONTHS_SHORT, toBangkokDateString } from '@/lib/date';
import { formatNumberDecimal } from '@/utils/formatters';
import type { PayrollGateDay } from '../types';

/**
 * Payroll D4 ส่วนที่ 1 — ถ้อยคำของด่านใบเงินเดือนบนเว็บ (ตาราง copy ของ global constraints — ห้ามแก้ถ้อยคำ)
 * วันที่จัดรูปเหมือน `payroll-post-gate.service.ts` ของ server ทุกตัวอักษร (คำตัดสิน R8)
 */

/** "1 พ.ย. 2569" (พ.ศ. · เวลาไทย) — {วันที่ไทยสั้น} ของเวลาปิดงวด */
export function thaiDateWithYear(iso: string): string {
  const [y, m, d] = toBangkokDateString(new Date(iso)).split('-').map(Number);
  return `${d} ${THAI_MONTHS_SHORT[m - 1]} ${y + 543}`;
}

/** 'YYYY-MM-DD' → "15 ต.ค." — วันในรายการวันติดธง (เดือนเดียวกับงวดเสมอ) */
const gateDayText = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${THAI_MONTHS_SHORT[m - 1]}`;
};

/** SUBMIT_CUTOFF */
export const submitCutoffText = (closableAt: string) =>
  `ส่งขออนุมัติได้ตั้งแต่ ${thaiDateWithYear(closableAt)} 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้`;

/** POST_CUTOFF */
export const postCutoffText = (closableAt: string) =>
  `ลงบัญชีได้ตั้งแต่ ${thaiDateWithYear(closableAt)} 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน`;

/** DEVICE_CONFLICT */
export const deviceConflictText = (days: PayrollGateDay[]) =>
  `อนุมัติไม่ได้ — มีวันที่ติดธง เครื่องถูกใช้ซ้อน ${days.length} วัน ` +
  `(${days.map((d) => `${d.employeeName} · ${gateDayText(d.date)}`).join(', ')}) ` +
  'ให้เจ้าของตรวจที่เมนู ลงเวลา แล้วกด "ตรวจแล้ว ล้างธง"';

/**
 * R20/R23 — คนที่เดือนนี้ไม่มีวันที่ตอกเข้าเลย (แถววางแผนวันหยุด/ลาไม่นับ · คำเตือน NO_PIN ขึ้นต้นด้วย "ยังไม่มีรหัสตอกบัตร — " · NO_ATTENDANCE ใช้ตามนี้) ระบบไม่คิด OT ให้
 * ⇒ บอกให้กรอกเองที่ส่วน "รายได้พิเศษ" ของฟอร์มใบเงินเดือน (หัวคอลัมน์/ปุ่ม "เพิ่มรายได้พิเศษ" ใน PayrollLinesSection)
 */
export const NO_ATTENDANCE_TEXT = 'เดือนนี้ไม่มีข้อมูลลงเวลา ระบบจึงไม่คิด OT ให้ — กรอก OT เองได้ที่ รายได้พิเศษ';

/** เหตุผลใต้ปุ่มส่ง/อนุมัติ/ลงบัญชีที่ถูกปิด */
export const NOT_YET_CLOSABLE_REASON = 'ยังไม่ถึงเวลาปิดงวด';
export const deviceConflictReason = (n: number) => `ติดธง เครื่องถูกใช้ซ้อน ${n} วัน`;

/** สลิปเงินเดือน — พิมพ์กระดาษอย่างเดียว (คำตัดสินเจ้าของ: ไม่ส่งทาง LINE/อีเมล) */
export const slipButtonLabel = (n: number) => `พิมพ์สลิปเงินเดือน (${n} ใบ)`;
export const SLIP_NEEDS_POST = 'ลงบัญชีก่อนจึงพิมพ์สลิปได้';
export const SLIP_PAPER_ONLY = 'สลิปพิมพ์กระดาษเท่านั้น — ไม่มีส่งทาง LINE หรืออีเมล';

/** 409 ของใบเงินเดือนจากหน้ารายการ — รายละเอียด (วันติดธง ตาราง diff) อยู่ที่หน้ารายละเอียด ซึ่งเปิดได้จากเมนู "เปิดใบ" */
export const OPEN_DOC_LABEL = 'เปิดใบ';
export const OPEN_DOC_HINT = 'เปิดใบเพื่อดูรายละเอียด';

/** ไฟล์โอนเงินเดือนเข้าธนาคาร — เฉพาะใบที่ลงบัญชีแล้ว (กระดาน 2) */
export const BANK_CSV_NEEDS_POST = 'ลงบัญชีก่อนจึงดาวน์โหลดไฟล์โอนได้';

/**
 * แถวที่ไฟล์โอนข้ามเพราะไม่มีเลขบัญชี — เลขบัญชีแก้ที่ ตั้งค่าระบบ › ผู้ใช้ & สิทธิ์ › ผู้ใช้ / พนักงาน (`/users`,
 * settings-registry 'access' › 'users') › แท็บ "HR / เงินเดือน" ของ `/users/:id` — เปิดได้เฉพาะ OWNER (App.tsx) ⇒
 * FM/ACCOUNTANT (ดาวน์โหลดไฟล์ได้ แต่เปิดหน้าผู้ใช้ไม่ได้) ให้เจ้าของเพิ่ม
 */
const USERS_MENU_PATH = 'ตั้งค่าระบบ › ผู้ใช้ & สิทธิ์ › ผู้ใช้ / พนักงาน';
export const bankCsvSkippedText = (skipped: number, viewerRole: string | undefined) =>
  `ข้าม ${skipped} คนที่ไม่มีเลขบัญชีธนาคารในทะเบียนพนักงาน — ` +
  (viewerRole === 'OWNER'
    ? `เพิ่มได้ที่ ${USERS_MENU_PATH} › แท็บ HR / เงินเดือน`
    : `ให้เจ้าของเพิ่มเลขบัญชีที่ ${USERS_MENU_PATH}`);

/** กระดาน 2 — คำอธิบายใต้ปุ่ม แก้ไข */
export const DRAFT_EDIT_CAPTION = 'บันทึกใหม่ ระบบคิดยอดให้';
export const STALE_EDIT_HINT = 'กด แก้ไข แล้วใบกลับเป็นร่างเอง — ไม่ต้องรอผู้อนุมัติกดส่งกลับ';

/** กระดาน 2 สถานะ ค — ใบลงบัญชีแล้ว: ลงเวลาของเดือนนั้นของคนในใบถูกล็อก (`attendance-payroll-lock.ts`: POSTED = จ่ายแล้ว) */
export const attendanceLockedText = (month: string, people: number) =>
  `ลงเวลา ${month} ของ ${people} คนในใบนี้ แก้ไม่ได้แล้ว — ปรับยอดให้ใส่ในงวดถัดไป`;
/** กลับรายการ (VOIDED) = ไม่นับว่าจ่ายแล้ว ⇒ แก้ลงเวลาได้อีก — แสดงเฉพาะคนที่มีปุ่ม "ยกเลิก / กลับรายการ" */
export const REVERSE_UNLOCKS_TEXT = 'กลับรายการใบนี้ → ลงเวลาเดือนนี้แก้ได้อีก';

/** ใต้ตารางบรรทัด — คอลัมน์ไม่มีภาษี/รายการหัก (ส่วนที่ 2 วางคอลัมน์เพิ่ม) */
export const NET_FOOTNOTE = 'สุทธิ = หลังหักภาษีและรายการหักอื่น';

// ─── D4 ส่วนที่ 2 — ค่าคอมในใบเงินเดือน (ตาราง copy ของ global constraints ส่วนที่ 2 — ห้ามแก้ถ้อยคำ) ───────────────

/** เงินบาท 2 ตำแหน่ง — "1,000.00" */
export const baht2 = (v: string | number) => formatNumberDecimal(v, 2);

/** ISO → "3 ต.ค." (วันไทย) — วันที่ของค่าคอมในรายการ */
export function thaiDayMonth(iso: string | null): string {
  if (!iso) return '';
  const [, m, d] = toBangkokDateString(new Date(iso)).split('-').map(Number);
  return `${d} ${THAI_MONTHS_SHORT[m - 1]}`;
}

/** warning COMMISSION_FINANCE_BLOCKED — แสดงครั้งเดียวต่อใบ */
export const COMMISSION_FINANCE_BLOCKED_TEXT = 'ใบฝั่งส่วนกลาง (FINANCE) ยังไม่ดึงค่าคอม — รอฝ่ายบัญชีตอบ';

/** warning COMMISSION_IN_OTHER_DOCUMENT */
export const commissionInOtherDocumentText = (count: number, name: string, documentNumber: string) =>
  `ค่าคอม ${count} รายการของ ${name} อยู่ในใบ ${documentNumber} แล้ว`;

/** warning CLAWBACK_CARRIED */
export const clawbackCarriedText = (deducted: string, carried: string) =>
  `หักคืนค่าคอมได้ ${baht2(deducted)} บาท (ไม่เกินค่าคอมงวดนี้) — ยกไปงวดหน้า ${baht2(carried)} บาท`;

/** warning CLAWBACK_PAID_OUTSIDE_PAYROLL */
export const clawbackPaidOutsideText = (reference: string) =>
  `ค่าคอม ${reference} ถูกเรียกคืน แต่จ่ายไปนอกใบเงินเดือน — ระบบไม่หักให้อัตโนมัติ ถ้าจะหัก ให้ใส่รายการหักในใบนี้เอง`;

/** ส่วนท้ายของคำเตือน CLAWBACK_CARRIED — ตารางหักในฟอร์ม · หน้ารายละเอียด */
export const carryForwardText = (carried: string) => `ยกไปงวดหน้า ${baht2(carried)} บาท`;

/** กระดาน 6B — ตารางรายการหักจากระบบในฟอร์ม (คู่กับ SYSTEM_ROWS_TITLE ของรายได้) */
export const SYSTEM_DEDUCTIONS_TITLE = 'รายการหักจากระบบ — แก้ในใบนี้ไม่ได้';
/** หมายเหตุใต้ตารางหักเมื่อยกยอดไป — ทำไมหักไม่ครบ (Decision 2: หักได้ไม่เกินค่าคอมงวดนี้ ไม่หักจากฐาน/OT) */
export const CLAWBACK_CAP_NOTE = 'หักได้ไม่เกินค่าคอมงวดนี้ — ไม่หักจากเงินเดือนฐานหรือ OT · ส่วนที่เหลือระบบหักต่อในงวดถัดไปเอง';
/** กระดาน 1 — ค่าคอมของงวดก่อนที่อนุมัติทีหลัง ถูกดึงเข้างวดนี้ */
export const EARLIER_PERIOD_LABEL = 'อนุมัติค้างจากงวดก่อน';
/** ป้าย/ปุ่มของแถวค่าคอม — n = รายการที่จ่าย */
export const commissionCountLabel = (n: number) => `ค่าคอม ${n} รายการ`;
