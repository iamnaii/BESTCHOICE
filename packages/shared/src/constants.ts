// User Roles
export const UserRole = {
  SALES: 'SALES',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  ACCOUNTANT: 'ACCOUNTANT',
  OWNER: 'OWNER',
} as const;

// Contract Status
export const ContractStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  OVERDUE: 'OVERDUE',
  DEFAULT: 'DEFAULT',
  EARLY_PAYOFF: 'EARLY_PAYOFF',
  COMPLETED: 'COMPLETED',
  EXCHANGED: 'EXCHANGED',
  CLOSED_BAD_DEBT: 'CLOSED_BAD_DEBT',
} as const;

// Product Status
export const ProductStatus = {
  PO_RECEIVED: 'PO_RECEIVED',
  INSPECTION: 'INSPECTION',
  IN_STOCK: 'IN_STOCK',
  RESERVED: 'RESERVED',
  SOLD_INSTALLMENT: 'SOLD_INSTALLMENT',
  SOLD_CASH: 'SOLD_CASH',
  REPOSSESSED: 'REPOSSESSED',
  REFURBISHED: 'REFURBISHED',
  SOLD_RESELL: 'SOLD_RESELL',
} as const;

// Payment Methods
export const PaymentMethod = {
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  QR_EWALLET: 'QR_EWALLET',
} as const;

// Plan Type (single type)
export const PlanType = {
  STORE_DIRECT: 'STORE_DIRECT',
} as const;

// Product Categories
export const ProductCategory = {
  PHONE_NEW: 'PHONE_NEW',
  PHONE_USED: 'PHONE_USED',
  TABLET: 'TABLET',
  ACCESSORY: 'ACCESSORY',
} as const;

// Payment Status
export const PaymentStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  OVERDUE: 'OVERDUE',
} as const;

// Sale Type
export const SaleType = {
  CASH: 'CASH',
  INSTALLMENT: 'INSTALLMENT',
  EXTERNAL_FINANCE: 'EXTERNAL_FINANCE',
} as const;

// Purchase Order Status
export const POStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  FULLY_RECEIVED: 'FULLY_RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;

// Repossession Status
export const RepossessionStatus = {
  REPOSSESSED: 'REPOSSESSED',
  UNDER_REPAIR: 'UNDER_REPAIR',
  READY_FOR_SALE: 'READY_FOR_SALE',
  SOLD: 'SOLD',
} as const;

// Thai labels for display
export const STATUS_LABELS = {
  contract: {
    DRAFT: 'แบบร่าง',
    ACTIVE: 'ปกติ',
    OVERDUE: 'ค้างชำระ',
    DEFAULT: 'ผิดนัด',
    EARLY_PAYOFF: 'ปิดก่อนกำหนด',
    COMPLETED: 'ปิดสัญญา',
    EXCHANGED: 'เปลี่ยนเครื่อง',
    CLOSED_BAD_DEBT: 'หนี้สูญ',
  },
  payment: {
    PENDING: 'รอชำระ',
    PAID: 'ชำระแล้ว',
    PARTIALLY_PAID: 'ชำระบางส่วน',
    OVERDUE: 'ค้างชำระ',
  },
  paymentMethod: {
    CASH: 'เงินสด',
    BANK_TRANSFER: 'โอนธนาคาร',
    QR_EWALLET: 'QR/E-Wallet',
  },
} as const;

// Default System Config
export const DEFAULT_CONFIG = {
  INTEREST_RATE: 0.08, // 8% per month
  MIN_DOWN_PAYMENT_PCT: 0.15, // 15%
  LATE_FEE_PER_DAY: 100, // baht
  LATE_FEE_CAP: 200, // baht per installment
  EARLY_PAYOFF_DISCOUNT: 0.5, // 50%
  MIN_INSTALLMENT_MONTHS: 6,
  MAX_INSTALLMENT_MONTHS: 12,
} as const;
