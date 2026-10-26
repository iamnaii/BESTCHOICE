/**
 * "จ่ายแล้ว" ของใบรายจ่ายสำหรับบิลประจำ — ที่เดียว ห้ามเขียนซ้ำ (สเปก §15.2)
 * POSTED + paidAt เท่านั้น: ใบตั้งหนี้ (ACCRUAL) / รออนุมัติ / ร่าง / VOIDED / ถูกลบ = ยังไม่จ่าย
 * (ใบจ่ายเจ้าหนี้ที่ล้างครบจะพาใบ EX ไป POSTED + paidAt เอง — `vendor-settlement.template.ts`)
 */
export interface PaidCheckDocument {
  deletedAt: Date | null;
  status: string;
  paidAt: Date | null;
}

export function isExpenseDocumentPaid(doc: PaidCheckDocument | null | undefined): boolean {
  return !!doc && doc.deletedAt == null && doc.status === 'POSTED' && doc.paidAt != null;
}

/** "ใบที่ยังอยู่" = ไม่ถูกลบและไม่ VOIDED (ครอบ DRAFT / PENDING_APPROVAL / APPROVED / ACCRUAL / POSTED) */
export function isLiveDocument(doc: Pick<PaidCheckDocument, 'deletedAt' | 'status'> | null | undefined): boolean {
  return !!doc && doc.deletedAt == null && doc.status !== 'VOIDED';
}

/** ฟิลด์ของใบที่งวดต้องอ่าน — ใช้กับ `include.expenseDocument.select` ทุกจุด */
export const OCCURRENCE_DOCUMENT_SELECT = {
  id: true,
  number: true,
  status: true,
  paidAt: true,
  deletedAt: true,
  documentDate: true,
  totalAmount: true,
  createdById: true,
  paymentMethod: true,
  depositAccountCode: true,
} as const;

export interface OccurrenceDocument extends PaidCheckDocument {
  id: string;
  number: string;
  documentDate: Date;
  createdById: string;
  totalAmount?: unknown;
  paymentMethod?: string | null;
  depositAccountCode?: string | null;
}
