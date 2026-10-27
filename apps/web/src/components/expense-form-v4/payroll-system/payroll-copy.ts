import { THAI_MONTHS_SHORT, toBangkokDateString } from '@/lib/date';
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
