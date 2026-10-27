/**
 * R20 (FX2) — อนุมัติ / ลงบัญชีใบเงินเดือนส่งฉบับที่หน้าวาด (`updatedAt`) กลับไปเป็น `expectedUpdatedAt`
 * server (`apps/api/src/modules/expense-documents/document-version.ts`) เทียบใต้ล็อกก่อนด่านใบเงินเดือน:
 * ใบเงินเดือน (PAYROLL) บังคับ · เอกสารอื่นเทียบเมื่อส่งมา · ไม่ตรง = 409 `DOCUMENT_CHANGED` (ข้อความของ server ชี้ปุ่มให้แล้ว)
 * R21 — เว็บส่งเฉพาะใบเงินเดือน เอกสารชนิดอื่นส่ง `{}` เหมือนก่อน R20 (พฤติกรรมเดิมทุกประการ)
 */
export const DOCUMENT_CHANGED = 'DOCUMENT_CHANGED';

/** body ของ `POST /expense-documents/:id/approve` และ `/post` — เฉพาะ PAYROLL ที่มี `updatedAt` · อื่น ๆ = `{}` (พฤติกรรมเดิม) */
export const documentVersionBody = (
  doc: { documentType?: string; updatedAt?: string | null } | null | undefined,
): { expectedUpdatedAt?: string } =>
  doc?.documentType === 'PAYROLL' && doc.updatedAt ? { expectedUpdatedAt: doc.updatedAt } : {};

/** ข้อความของ 409 `DOCUMENT_CHANGED` จาก error ของ axios (รูปที่ SentryExceptionFilter ส่ง) · อย่างอื่น = null */
export function documentChangedMessage(err: unknown): string | null {
  const res = (err as { response?: { status?: number; data?: Record<string, unknown> } } | null)?.response;
  if (res?.status !== 409 || res.data?.code !== DOCUMENT_CHANGED) return null;
  return typeof res.data?.message === 'string' ? res.data.message : '';
}
