/**
 * Centralized status badge configuration.
 * Maps every status enum to a Badge variant + Thai label so all pages
 * show consistent colours without inline className strings.
 *
 * Usage:
 *   import { getStatusBadgeProps, contractStatusMap } from '@/lib/status-badges';
 *   const cfg = getStatusBadgeProps(contract.status, contractStatusMap);
 *   <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>
 */

import type { VariantProps } from 'class-variance-authority';
import type { badgeVariants } from '@/components/ui/badge';

export interface StatusConfig {
  variant: VariantProps<typeof badgeVariants>['variant'];
  appearance?: VariantProps<typeof badgeVariants>['appearance'];
  label: string;
}

// ─── Contract statuses ───────────────────────────────────────────────────────

export const contractStatusMap: Record<string, StatusConfig> = {
  DRAFT: { variant: 'secondary', label: 'ร่าง' },
  ACTIVE: { variant: 'success', appearance: 'light', label: 'ผ่อนอยู่' },
  OVERDUE: { variant: 'warning', appearance: 'light', label: 'ค้างชำระ' },
  DEFAULT: { variant: 'destructive', appearance: 'light', label: 'ผิดนัด' },
  EARLY_PAYOFF: { variant: 'primary', appearance: 'light', label: 'ปิดก่อนกำหนด' },
  COMPLETED: { variant: 'success', appearance: 'light', label: 'ครบกำหนด' },
  EXCHANGED: { variant: 'info', appearance: 'light', label: 'เปลี่ยนเครื่อง' },
  CLOSED_BAD_DEBT: { variant: 'destructive', label: 'ตัดหนี้สูญ' },
};

// ─── Payment statuses ─────────────────────────────────────────────────────────

export const paymentStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'secondary', label: 'รอชำระ' },
  PAID: { variant: 'success', appearance: 'light', label: 'ชำระแล้ว' },
  PARTIALLY_PAID: { variant: 'warning', appearance: 'light', label: 'ชำระบางส่วน' },
  OVERDUE: { variant: 'destructive', appearance: 'light', label: 'ค้างชำระ' },
};

// ─── Dunning stages ───────────────────────────────────────────────────────────

export const dunningStageMap: Record<string, StatusConfig> = {
  NONE: { variant: 'secondary', label: 'ปกติ' },
  REMINDER: { variant: 'warning', appearance: 'light', label: 'แจ้งเตือน' },
  NOTICE: { variant: 'warning', label: 'แจ้งค้างชำระ' },
  FINAL_WARNING: { variant: 'destructive', appearance: 'light', label: 'เตือนครั้งสุดท้าย' },
  LEGAL_ACTION: { variant: 'destructive', label: 'ดำเนินคดี' },
};

// ─── Collection stages ────────────────────────────────────────────────────────

export const collectionStageMap: Record<string, StatusConfig> = {
  NORMAL: { variant: 'secondary', label: 'ปกติ' },
  REMINDED: { variant: 'warning', appearance: 'light', label: 'แจ้งเตือนแล้ว' },
  OVERDUE: { variant: 'warning', label: 'ค้างชำระ' },
  CONTACTED: { variant: 'info', appearance: 'light', label: 'ติดต่อแล้ว' },
  PROMISE_TO_PAY: { variant: 'info', label: 'สัญญาจ่าย' },
  ESCALATED_FM: { variant: 'destructive', appearance: 'light', label: 'ส่งผจก.การเงิน' },
  MDM_LOCKED: { variant: 'destructive', label: 'ล็อคเครื่องแล้ว' },
  REPOSSESSION: { variant: 'destructive', label: 'ยึดเครื่องแล้ว' },
};

// ─── Finance receivable statuses ──────────────────────────────────────────────

export const financeReceivableStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอรับเงิน' },
  PARTIALLY_RECEIVED: { variant: 'warning', label: 'ได้รับบางส่วน' },
  RECEIVED: { variant: 'success', appearance: 'light', label: 'ได้รับแล้ว' },
  OVERDUE: { variant: 'destructive', appearance: 'light', label: 'เกินกำหนด' },
  DISPUTED: { variant: 'destructive', label: 'มีปัญหา' },
};

// ─── Inter-company transaction statuses ──────────────────────────────────────

export const interCompanyStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอดำเนินการ' },
  CONFIRMED: { variant: 'primary', appearance: 'light', label: 'ยืนยันแล้ว' },
  RECONCILED: { variant: 'success', appearance: 'light', label: 'กระทบยอดแล้ว' },
};

// ─── Stock transfer statuses ──────────────────────────────────────────────────

export const transferStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอจัดส่ง' },
  IN_TRANSIT: { variant: 'info', appearance: 'light', label: 'ระหว่างโอนสินค้า' },
  CONFIRMED: { variant: 'success', appearance: 'light', label: 'รับแล้ว' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ปฏิเสธ' },
};

// ─── Product statuses ─────────────────────────────────────────────────────────

export const productStatusMap: Record<string, StatusConfig> = {
  PO_RECEIVED: { variant: 'primary', appearance: 'light', label: 'รับจาก PO' },
  QC_PENDING: { variant: 'warning', appearance: 'light', label: 'รอตรวจรับ' },
  PHOTO_PENDING: { variant: 'primary', appearance: 'light', label: 'รอถ่ายรูป' },
  INSPECTION: { variant: 'warning', label: 'กำลังตรวจ' },
  IN_STOCK: { variant: 'success', appearance: 'light', label: 'พร้อมขาย' },
  RESERVED: { variant: 'info', appearance: 'light', label: 'จอง' },
  SOLD_INSTALLMENT: { variant: 'primary', label: 'ขายผ่อน' },
  SOLD_CASH: { variant: 'success', label: 'ขายสด' },
  REPOSSESSED: { variant: 'destructive', appearance: 'light', label: 'ยึดคืน' },
  REFURBISHED: { variant: 'warning', label: 'ซ่อมแล้ว' },
  SOLD_RESELL: { variant: 'info', label: 'ขายต่อ' },
  DAMAGED: { variant: 'destructive', appearance: 'light', label: 'เสียหาย' },
  LOST: { variant: 'destructive', label: 'สูญหาย' },
  WRITTEN_OFF: { variant: 'secondary', label: 'ตัดจำหน่าย' },
};

// ─── Credit check statuses ───────────────────────────────────────────────────

export const creditCheckStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'secondary', label: 'รอวิเคราะห์' },
  APPROVED: { variant: 'success', appearance: 'light', label: 'ผ่าน' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ไม่ผ่าน' },
  MANUAL_REVIEW: { variant: 'warning', appearance: 'light', label: 'ต้องตรวจเพิ่ม' },
};

// ─── Repossession statuses ────────────────────────────────────────────────────

export const repossessionStatusMap: Record<string, StatusConfig> = {
  REPOSSESSED: { variant: 'destructive', appearance: 'light', label: 'ยึดคืนแล้ว' },
  UNDER_REPAIR: { variant: 'warning', appearance: 'light', label: 'กำลังซ่อม' },
  READY_FOR_SALE: { variant: 'success', appearance: 'light', label: 'พร้อมขาย' },
  SOLD: { variant: 'primary', appearance: 'light', label: 'ขายแล้ว' },
};

// ─── Condition grades ─────────────────────────────────────────────────────────

export const conditionGradeMap: Record<string, StatusConfig> = {
  A: { variant: 'success', appearance: 'light', label: 'เกรด A' },
  B: { variant: 'primary', appearance: 'light', label: 'เกรด B' },
  C: { variant: 'warning', appearance: 'light', label: 'เกรด C' },
  D: { variant: 'destructive', appearance: 'light', label: 'เกรด D' },
};

// ─── Risk levels ──────────────────────────────────────────────────────────────

export const riskLevelMap: Record<string, StatusConfig> = {
  HIGH: { variant: 'destructive', appearance: 'light', label: 'สูง' },
  MEDIUM: { variant: 'warning', appearance: 'light', label: 'กลาง' },
  LOW: { variant: 'warning', label: 'ต่ำ' },
};

// ─── Purchase Order statuses ─────────────────────────────────────────────────

export const poStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'secondary', label: 'รอดำเนินการ' },
  DRAFT: { variant: 'warning', appearance: 'light', label: 'รออนุมัติ' },
  APPROVED: { variant: 'primary', appearance: 'light', label: 'อนุมัติแล้ว' },
  PARTIALLY_RECEIVED: { variant: 'warning', appearance: 'light', label: 'รับบางส่วน' },
  FULLY_RECEIVED: { variant: 'success', appearance: 'light', label: 'รับครบแล้ว' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Purchase Order payment statuses ─────────────────────────────────────────

export const poPaymentStatusMap: Record<string, StatusConfig> = {
  UNPAID: { variant: 'destructive', appearance: 'light', label: 'ยังไม่จ่าย' },
  DEPOSIT_PAID: { variant: 'warning', appearance: 'light', label: 'จ่ายมัดจำ' },
  PARTIALLY_PAID: { variant: 'primary', appearance: 'light', label: 'จ่ายบางส่วน' },
  FULLY_PAID: { variant: 'success', appearance: 'light', label: 'จ่ายครบแล้ว' },
};

// ─── Stock count statuses ────────────────────────────────────────────────────

export const stockCountStatusMap: Record<string, StatusConfig> = {
  DRAFT: { variant: 'secondary', label: 'ร่าง' },
  IN_PROGRESS: { variant: 'warning', appearance: 'light', label: 'กำลังตรวจนับ' },
  COMPLETED: { variant: 'success', appearance: 'light', label: 'เสร็จสิ้น' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Inspection / QC statuses ────────────────────────────────────────────────

export const inspectionStatusMap: Record<string, StatusConfig> = {
  RECEIVED: { variant: 'info', appearance: 'light', label: 'รอตรวจ' },
  INSPECTING: { variant: 'warning', appearance: 'light', label: 'กำลังตรวจ' },
  QC_PASSED: { variant: 'success', appearance: 'light', label: 'ผ่าน QC' },
  QC_FAILED: { variant: 'destructive', appearance: 'light', label: 'ไม่ผ่าน QC' },
  IN_STOCK: { variant: 'primary', appearance: 'light', label: 'เข้าสต็อกแล้ว' },
};

// ─── Stock alert statuses ────────────────────────────────────────────────────

export const stockAlertStatusMap: Record<string, StatusConfig> = {
  ACTIVE: { variant: 'destructive', appearance: 'light', label: 'ต้องดำเนินการ' },
  PO_CREATED: { variant: 'primary', appearance: 'light', label: 'สร้าง PO แล้ว' },
  RESOLVED: { variant: 'success', appearance: 'light', label: 'แก้ไขแล้ว' },
};

// ─── Stock adjustment reasons ─────────────────────────────────────────────────

export const stockAdjustmentReasonMap: Record<string, StatusConfig> = {
  DAMAGED: { variant: 'destructive', appearance: 'light', label: 'เสียหาย' },
  LOST: { variant: 'warning', appearance: 'light', label: 'สูญหาย' },
  FOUND: { variant: 'success', appearance: 'light', label: 'พบเพิ่ม' },
  CORRECTION: { variant: 'primary', appearance: 'light', label: 'แก้ไขข้อมูล' },
  WRITE_OFF: { variant: 'secondary', label: 'ตัดจำหน่าย' },
  OTHER: { variant: 'secondary', label: 'อื่นๆ' },
};

// ─── General helper ───────────────────────────────────────────────────────────

/**
 * Look up a status in a map.  Falls back to `{ variant: 'secondary', label: status }`
 * so unknown values still render safely.
 */
export function getStatusBadgeProps(
  status: string,
  map: Record<string, StatusConfig>,
): StatusConfig {
  return map[status] ?? { variant: 'secondary', label: status };
}
