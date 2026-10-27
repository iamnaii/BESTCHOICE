import { ConflictException } from '@nestjs/common';

/**
 * Payroll D4 ส่วนที่ 1 · R20 (FX2) — อนุมัติ / ลงบัญชีต้องเป็นฉบับของใบที่ผู้กดเห็น
 *
 * เหตุ: ใบเงินเดือนที่รออนุมัติ/อนุมัติแล้วแก้ได้ (กด "แก้ไข" = ส่งกลับเป็นร่าง) ⇒ ผู้ทำเงินเดือนแก้แล้วส่งใหม่ระหว่างที่
 * หน้าของผู้อนุมัติยังวาดยอดเดิม แล้วผู้อนุมัติกดอนุมัติ = ระบบลงบัญชีฉบับใหม่ที่ไม่มีใครเห็น · ด่านใบเงินเดือนจับไม่ได้
 * เพราะการแก้เขียนแถวที่เก็บใหม่หมด ⇒ หน้าเว็บส่ง `updatedAt` ที่วาดกลับมาเป็น `expectedUpdatedAt` แล้ว server เทียบ
 * ใต้ล็อก `post:${id}` หลังด่านขออนุมัติ/ด่านสถานะ (R23) และก่อนด่านใบเงินเดือนกับการเขียนใด ๆ
 * - PAYROLL: บังคับ — ไม่ส่ง / ไม่ตรง / อ่านไม่ออก ⇒ 409 `DOCUMENT_CHANGED`
 * - เอกสารอื่น: ไม่บังคับ (พฤติกรรมเดิม) — เทียบเฉพาะเมื่อส่งมา
 * ทุกทางเขียนใบเงินเดือน (PATCH · ตอนส่งขออนุมัติ · เปลี่ยนสถานะ) อัปเดตแถวเอกสารเอง ⇒ `@updatedAt` ขยับทุกครั้ง
 */

export interface DocumentVersionOpts {
  /** `updatedAt` ของใบตามที่หน้าวาด (ISO 8601) */
  expectedUpdatedAt?: string;
}

export const DOCUMENT_CHANGED = 'DOCUMENT_CHANGED';

/** ชื่อปุ่มจริง — `InternalControlActionBar` (หน้ารายละเอียด) และปุ่มบันทึกของฟอร์ม (`ExpenseFormV4`) */
const BUTTON_LABEL = { approve: 'อนุมัติและลงบัญชี', post: 'บันทึกและลงบัญชี' } as const;

export const documentChangedMessage = (action: keyof typeof BUTTON_LABEL) =>
  `ใบนี้ถูกแก้ไขหลังจากที่คุณเปิดดู — โหลดหน้านี้ใหม่ ตรวจยอดอีกครั้ง แล้วกด ${BUTTON_LABEL[action]}`;

/** ผู้เรียกถือล็อก `post:${id}` และอ่านแถวเอกสารใต้ล็อกแล้ว */
export function assertDocumentVersion(
  doc: { documentType: string; updatedAt: Date },
  expectedUpdatedAt: string | undefined,
  action: keyof typeof BUTTON_LABEL,
): void {
  if (expectedUpdatedAt == null) {
    if (doc.documentType !== 'PAYROLL') return;
  } else {
    const expected = new Date(expectedUpdatedAt).getTime();
    if (!Number.isNaN(expected) && expected === doc.updatedAt.getTime()) return;
  }
  throw new ConflictException({ code: DOCUMENT_CHANGED, message: documentChangedMessage(action) });
}
