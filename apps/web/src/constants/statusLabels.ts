/** Centralized status label definitions — single source of truth for badge text + Tailwind classes */

export const CONTRACT_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'ร่าง', className: 'bg-muted text-foreground' },
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-yellow-100 text-yellow-700' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-red-100 text-red-700' },
  EARLY_PAYOFF: { label: 'ปิดก่อนกำหนด', className: 'bg-primary/10 text-primary' },
  COMPLETED: { label: 'ปิดบัญชี', className: 'bg-teal-100 text-teal-700' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-primary/10 text-primary' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-red-200 text-red-800' },
  CANCELLED: { label: 'ยกเลิก', className: 'bg-muted text-muted-foreground' },
};

export const PAYMENT_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-muted text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-red-100 text-red-700' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-yellow-100 text-yellow-700' },
};

export const PRODUCT_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PO_RECEIVED: { label: 'รับจาก PO', className: 'bg-primary/10 text-primary' },
  INSPECTION: { label: 'กำลังตรวจ', className: 'bg-yellow-100 text-yellow-700' },
  IN_STOCK: { label: 'พร้อมขาย', className: 'bg-green-100 text-green-700' },
  RESERVED: { label: 'จอง', className: 'bg-primary/10 text-primary' },
  SOLD_INSTALLMENT: { label: 'ขายผ่อน', className: 'bg-indigo-100 text-indigo-700' },
  SOLD_CASH: { label: 'ขายสด', className: 'bg-teal-100 text-teal-700' },
  REPOSSESSED: { label: 'ยึดคืน', className: 'bg-red-100 text-red-700' },
  REFURBISHED: { label: 'ซ่อมแล้ว', className: 'bg-orange-100 text-orange-700' },
  SOLD_RESELL: { label: 'ขายต่อ', className: 'bg-cyan-100 text-cyan-700' },
};
