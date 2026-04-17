/**
 * Centralized status badge configuration
 * Single source of truth for all status → label + className mappings
 */

export type StatusType =
  | 'contract'
  | 'payment'
  | 'product'
  | 'transfer'
  | 'purchaseOrder'
  | 'poPayment'
  | 'workflow'
  | 'dunning'
  | 'expense';

interface BadgeConfig {
  label: string;
  className: string;
}

const fallback: BadgeConfig = {
  label: '',
  className: 'bg-muted text-foreground',
};

// --- Contract Status ---
const contractStatus: Record<string, BadgeConfig> = {
  DRAFT: { label: 'ร่าง', className: 'bg-muted text-foreground' },
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  EARLY_PAYOFF: { label: 'ปิดก่อน', className: 'bg-primary/10 text-primary dark:bg-primary/15' },
  COMPLETED: { label: 'ครบ', className: 'bg-success/10 text-success dark:bg-success/15' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-info/10 text-info dark:bg-info/15' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-destructive/15 text-destructive dark:bg-destructive/20' },
};

// --- Payment Status ---
const paymentStatus: Record<string, BadgeConfig> = {
  PENDING: { label: 'รอชำระ', className: 'bg-muted text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
};

// --- Product Status (re-exported from constants.ts pattern) ---
const productStatus: Record<string, BadgeConfig> = {
  PO_RECEIVED: { label: 'รับจาก PO', className: 'bg-primary/10 text-primary' },
  QC_PENDING: { label: 'รอตรวจรับ', className: 'bg-warning/10 text-warning' },
  PHOTO_PENDING: { label: 'รอถ่ายรูป', className: 'bg-primary/10 text-primary' },
  INSPECTION: { label: 'กำลังตรวจ', className: 'bg-warning/10 text-warning' },
  IN_STOCK: { label: 'พร้อมขาย', className: 'bg-success/10 text-success' },
  RESERVED: { label: 'จอง', className: 'bg-primary/10 text-primary' },
  SOLD_INSTALLMENT: { label: 'ขายผ่อน', className: 'bg-primary/10 text-primary' },
  SOLD_CASH: { label: 'ขายสด', className: 'bg-info/10 text-info' },
  REPOSSESSED: { label: 'ยึดคืน', className: 'bg-destructive/10 text-destructive' },
  REFURBISHED: { label: 'ซ่อมแล้ว', className: 'bg-warning/10 text-warning' },
  SOLD_RESELL: { label: 'ขายต่อ', className: 'bg-info/10 text-info' },
  DAMAGED: { label: 'เสียหาย', className: 'bg-destructive/10 text-destructive' },
  LOST: { label: 'สูญหาย', className: 'bg-destructive/10 text-destructive' },
  WRITTEN_OFF: { label: 'ตัดจำหน่าย', className: 'bg-muted text-muted-foreground' },
};

// --- Transfer Status ---
const transferStatus: Record<string, BadgeConfig> = {
  PENDING: { label: 'รอจัดส่ง', className: 'bg-warning/10 text-warning' },
  IN_TRANSIT: { label: 'ระหว่างโอนสินค้า', className: 'bg-primary/10 text-primary' },
  CONFIRMED: { label: 'รับแล้ว', className: 'bg-success/10 text-success' },
  REJECTED: { label: 'ปฏิเสธ', className: 'bg-destructive/10 text-destructive' },
};

// --- Purchase Order Status ---
const purchaseOrderStatus: Record<string, BadgeConfig> = {
  PENDING: { label: 'รอดำเนินการ', className: 'bg-muted text-foreground' },
  DRAFT: { label: 'รออนุมัติ', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  APPROVED: { label: 'อนุมัติแล้ว', className: 'bg-primary/10 text-primary' },
  PARTIALLY_RECEIVED: { label: 'รับบางส่วน', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  FULLY_RECEIVED: { label: 'รับครบแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  CANCELLED: { label: 'ยกเลิก', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
};

// --- PO Payment Status ---
const poPaymentStatus: Record<string, BadgeConfig> = {
  UNPAID: { label: 'ยังไม่จ่าย', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  DEPOSIT_PAID: { label: 'จ่ายมัดจำ', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  PARTIALLY_PAID: { label: 'จ่ายบางส่วน', className: 'bg-primary/10 text-primary' },
  FULLY_PAID: { label: 'จ่ายครบแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
};

// --- Workflow Status ---
const workflowStatus: Record<string, BadgeConfig> = {
  CREATING: { label: 'กำลังสร้าง', className: 'bg-muted text-foreground' },
  PENDING_REVIEW: { label: 'รออนุมัติ', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  APPROVED: { label: 'อนุมัติ', className: 'bg-success/10 text-success dark:bg-success/15' },
  REJECTED: { label: 'ไม่อนุมัติ', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
};

// --- Dunning Stage ---
const dunningStatus: Record<string, BadgeConfig> = {
  NONE: { label: 'ปกติ', className: 'bg-muted/60 text-muted-foreground' },
  REMINDER: { label: 'แจ้งเตือน', className: 'bg-warning/10 text-warning border-warning/30' },
  NOTICE: { label: 'แจ้งค้างชำระ', className: 'bg-warning/10 text-warning border-warning/30' },
  FINAL_WARNING: { label: 'เตือนครั้งสุดท้าย', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  LEGAL_ACTION: { label: 'ดำเนินคดี', className: 'bg-destructive/20 text-destructive border-destructive/50' },
};

// --- Expense Status ---
const expenseStatus: Record<string, BadgeConfig> = {
  PENDING: { label: 'รออนุมัติ', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  APPROVED: { label: 'อนุมัติ', className: 'bg-success/10 text-success dark:bg-success/15' },
  PAID: { label: 'จ่ายแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  REJECTED: { label: 'ไม่อนุมัติ', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  VOIDED: { label: 'ยกเลิก', className: 'bg-muted text-foreground' },
};

const statusMaps: Record<StatusType, Record<string, BadgeConfig>> = {
  contract: contractStatus,
  payment: paymentStatus,
  product: productStatus,
  transfer: transferStatus,
  purchaseOrder: purchaseOrderStatus,
  poPayment: poPaymentStatus,
  workflow: workflowStatus,
  dunning: dunningStatus,
  expense: expenseStatus,
};

/**
 * Get badge config (label + className) for a given status type and value.
 *
 * Usage:
 *   const badge = getStatusBadge('contract', 'ACTIVE');
 *   <span className={badge.className}>{badge.label}</span>
 */
export function getStatusBadge(type: StatusType, value: string | undefined | null): BadgeConfig {
  if (!value) return fallback;
  return statusMaps[type]?.[value] ?? { ...fallback, label: value };
}

/**
 * Get the full status map for a given type (useful for filters, selects).
 *
 * Usage:
 *   const statuses = getStatusMap('contract');
 *   Object.entries(statuses).map(([value, { label }]) => ...)
 */
export function getStatusMap(type: StatusType): Record<string, BadgeConfig> {
  return statusMaps[type] ?? {};
}

/**
 * Hook version — returns getStatusBadge and getStatusMap.
 * Useful when you want a consistent import pattern with other hooks.
 */
export function useStatusBadge() {
  return { getStatusBadge, getStatusMap };
}
