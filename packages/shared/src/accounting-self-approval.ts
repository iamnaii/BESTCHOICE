/**
 * source of truth เดียวของ "ใครอนุมัติเอกสารบัญชีที่ตัวเองสร้างได้" — ใช้ร่วมทั้ง apps/api และ apps/web
 *
 * ที่มา: #1542 ย้ายอำนาจอนุมัติรายการบัญชีไปที่ SystemConfig `accounting_permissions` และระหว่างนั้น
 * ถอดเงื่อนไข `doc.createdById !== user.id` ออกจาก `isViewerApprover` ของหน้ารายจ่าย ⇒ ฝั่งรายจ่าย
 * เปิดให้ทุกคนที่มีสิทธิ์อนุมัติเอกสารตัวเองได้ ขณะที่ฝั่งรายรับยังกันไว้ทุกคน และ `approve()` ทั้งสอง
 * ฝั่งไม่เคยมีด่านนี้เลย — สองหน้าจอคนละกฎ ส่วนเซิร์ฟเวอร์ไม่มีกฎ
 *
 * คำตัดสินเจ้าของ 2026-09-11: **อนุมัติเอกสารตัวเองได้ ถ้าเป็นระดับผู้จัดการขึ้นไป**
 * ⇒ OWNER / FINANCE_MANAGER / BRANCH_MANAGER ได้ · ACCOUNTANT ไม่ได้ (ฝ่ายบัญชีไม่ใช่ผู้จัดการ
 *   สร้างเอกสารแล้วต้องให้คนอื่นอนุมัติ = คง maker≠checker ไว้กับระดับปฏิบัติการ)
 *
 * กฎนี้เป็นด่าน "ซ้อน" บนสิทธิ์ `EXPENSE_APPROVE` / `INCOME_APPROVE` ไม่ใช่ตัวแทน — ต้องมีสิทธิ์
 * อนุมัติก่อนเสมอ แล้วกฎนี้ค่อยตัดสินเฉพาะกรณี "เอกสารใบนั้นตัวเองเป็นคนสร้าง"
 */

/** role ที่ถือว่าเป็น "ระดับผู้จัดการขึ้นไป" ตามคำตัดสินเจ้าของ 2026-09-11 */
export const SELF_APPROVAL_ROLES = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'] as const;
export type SelfApprovalRole = (typeof SELF_APPROVAL_ROLES)[number];

/**
 * อนุมัติเอกสารที่ตัวเองสร้างได้ไหม — role ที่ไม่รู้จัก/ว่าง = ไม่ได้ (fail-closed)
 * ต่างจาก resolveCompanyAccess ที่ fail-open เพราะอันนั้นเป็นเรื่อง "เห็นเมนูไหม"
 * ส่วนอันนี้เป็นด่านควบคุมภายใน เดาผิดแล้วเงินออกโดยไม่มีคนที่สองตรวจ
 */
export function canSelfApproveAccountingDoc(role: string | null | undefined): boolean {
  return !!role && (SELF_APPROVAL_ROLES as readonly string[]).includes(role);
}

/**
 * ด่านเดียวที่ทั้งปุ่มบนหน้าจอและ approve() ฝั่งเซิร์ฟเวอร์เรียกใช้ — คืน true เมื่ออนุมัติใบนี้ได้
 * (สมมติว่าผู้ใช้มีสิทธิ์ EXPENSE_APPROVE / INCOME_APPROVE มาแล้ว)
 */
export function canApproveAccountingDoc(params: {
  role: string | null | undefined;
  actorUserId: string | null | undefined;
  documentCreatedById: string | null | undefined;
}): boolean {
  const isOwnDoc = !!params.actorUserId && params.actorUserId === params.documentCreatedById;
  return !isOwnDoc || canSelfApproveAccountingDoc(params.role);
}

/** ข้อความเดียวกันทั้ง API และหน้าจอ จะได้ไม่เพี้ยนกันเวลาผู้ใช้ถาม */
export const SELF_APPROVAL_DENIED_MESSAGE =
  'อนุมัติเอกสารที่ตัวเองสร้างไม่ได้ — ต้องเป็นระดับผู้จัดการขึ้นไป';
