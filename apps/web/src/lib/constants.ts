// Centralized constants for labels and options
// These must stay in sync with Prisma enums in prisma/schema.prisma

// --- Product Status ---

export const statusLabels: Record<string, { label: string; className: string }> = {
  PO_RECEIVED: { label: 'รับจาก PO', className: 'bg-blue-100 text-blue-700' },
  INSPECTION: { label: 'กำลังตรวจ', className: 'bg-yellow-100 text-yellow-700' },
  IN_STOCK: { label: 'พร้อมขาย', className: 'bg-green-100 text-green-700' },
  RESERVED: { label: 'จอง', className: 'bg-purple-100 text-purple-700' },
  SOLD_INSTALLMENT: { label: 'ขายผ่อน', className: 'bg-indigo-100 text-indigo-700' },
  SOLD_CASH: { label: 'ขายสด', className: 'bg-teal-100 text-teal-700' },
  REPOSSESSED: { label: 'ยึดคืน', className: 'bg-red-100 text-red-700' },
  REFURBISHED: { label: 'ซ่อมแล้ว', className: 'bg-orange-100 text-orange-700' },
  SOLD_RESELL: { label: 'ขายต่อ', className: 'bg-cyan-100 text-cyan-700' },
};

// Statuses that are valid for product creation
export const createProductStatusOptions = [
  { value: 'IN_STOCK', label: 'พร้อมขาย' },
  { value: 'PO_RECEIVED', label: 'รับจาก PO' },
  { value: 'INSPECTION', label: 'กำลังตรวจ' },
];

// Statuses that allow stock transfer (must match backend)
export const transferableStatuses = ['IN_STOCK', 'PO_RECEIVED'];

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
  CASH: { label: 'เงินสด', color: 'text-green-700', bg: 'bg-green-50 border-green-300 ring-green-500' },
  INSTALLMENT: { label: 'ผ่อนกับ BESTCHOICE', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-300 ring-blue-500' },
  EXTERNAL_FINANCE: { label: 'ผ่อนไฟแนนซ์', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-300 ring-purple-500' },
};

// --- Plan Type ---

export const planTypes = [
  { value: 'STORE_DIRECT', label: 'ผ่อนกับ BESTCHOICE' },
  { value: 'CREDIT_CARD', label: 'ผ่อนบัตรเครดิต' },
  { value: 'STORE_WITH_INTEREST', label: 'ผ่อนกับ BESTCHOICE+ดอกเบี้ย' },
];

// --- Payment Method ---

export const paymentMethods = [
  { value: 'CASH', label: 'เงินสด' },
  { value: 'BANK_TRANSFER', label: 'โอนเงิน' },
];

// --- Condition Grade ---

export const gradeOptions = [
  { value: '', label: 'ไม่ระบุ' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
];

// --- Transfer Status ---

export const transferStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอยืนยัน', className: 'bg-orange-100 text-orange-700' },
  CONFIRMED: { label: 'ยืนยันแล้ว', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'ปฏิเสธ', className: 'bg-red-100 text-red-700' },
};
