// Centralized constants for labels and options
// These must stay in sync with Prisma enums in prisma/schema.prisma

// --- Product Status ---

export const statusLabels: Record<string, { label: string; className: string }> = {
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

// Statuses that are valid for product creation
export const createProductStatusOptions = [
  { value: 'IN_STOCK', label: 'พร้อมขาย' },
  { value: 'PO_RECEIVED', label: 'รับจาก PO' },
  { value: 'INSPECTION', label: 'กำลังตรวจ' },
];

// Statuses that allow stock transfer (must match backend)
export const transferableStatuses = ['IN_STOCK', 'PO_RECEIVED'];

// --- Thai Name Prefixes ---

export const THAI_NAME_PREFIXES = ['นาย', 'นาง', 'นางสาว'];

// --- Relationship Options (บุคคลอ้างอิง) ---

export const RELATIONSHIP_OPTIONS = ['บิดา', 'มารดา', 'พี่น้อง', 'คู่สมรส', 'แฟน', 'บุตร', 'ญาติ', 'เพื่อน', 'อื่นๆ'];

// --- Product Category ---

export const categoryLabels: Record<string, string> = {
  PHONE_NEW: 'มือถือใหม่',
  PHONE_USED: 'มือถือมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

export const categoryOptions = [
  { value: 'PHONE_NEW', label: 'มือถือใหม่' },
  { value: 'PHONE_USED', label: 'มือถือมือสอง' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'ACCESSORY', label: 'อุปกรณ์เสริม' },
];

// --- Sale Type ---

export type SaleType = 'CASH' | 'INSTALLMENT' | 'EXTERNAL_FINANCE';

export const saleTypeConfig: Record<SaleType, { label: string; color: string; bg: string }> = {
  CASH: { label: 'เงินสด', color: 'text-success', bg: 'bg-success/10 border-success/30 ring-success' },
  INSTALLMENT: { label: 'ผ่อนกับ BESTCHOICE', color: 'text-primary', bg: 'bg-primary/10 border-primary/30 ring-primary' },
  EXTERNAL_FINANCE: { label: 'ผ่อนไฟแนนซ์', color: 'text-primary', bg: 'bg-primary/10 border-primary/30 ring-primary' },
};

// --- Plan Type (single type: STORE_DIRECT) ---

export const PLAN_TYPE = 'STORE_DIRECT';
export const PLAN_TYPE_LABEL = 'ผ่อนกับ BESTCHOICE';

// --- Payment Method ---

export const paymentMethods = [
  { value: 'CASH', label: 'เงินสด' },
  { value: 'BANK_TRANSFER', label: 'โอนเงิน' },
];

// --- Transfer Status ---

export const transferStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอจัดส่ง', className: 'bg-warning/10 text-warning' },
  IN_TRANSIT: { label: 'ระหว่างโอนสินค้า', className: 'bg-primary/10 text-primary' },
  CONFIRMED: { label: 'รับแล้ว', className: 'bg-success/10 text-success' },
  REJECTED: { label: 'ปฏิเสธ', className: 'bg-destructive/10 text-destructive' },
};
