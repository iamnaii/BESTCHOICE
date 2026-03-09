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

// Contract Workflow Status
export const ContractWorkflowStatus = {
  CREATING: 'CREATING',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

// Product Status (synced with Prisma schema)
export const ProductStatus = {
  PO_RECEIVED: 'PO_RECEIVED',
  QC_PENDING: 'QC_PENDING',
  PHOTO_PENDING: 'PHOTO_PENDING',
  INSPECTION: 'INSPECTION',
  IN_STOCK: 'IN_STOCK',
  RESERVED: 'RESERVED',
  SOLD_INSTALLMENT: 'SOLD_INSTALLMENT',
  SOLD_CASH: 'SOLD_CASH',
  REPOSSESSED: 'REPOSSESSED',
  REFURBISHED: 'REFURBISHED',
  SOLD_RESELL: 'SOLD_RESELL',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
  WRITTEN_OFF: 'WRITTEN_OFF',
} as const;

// Payment Methods
export const PaymentMethod = {
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  QR_EWALLET: 'QR_EWALLET',
} as const;

// Plan Type (synced with Prisma schema)
export const PlanType = {
  STORE_DIRECT: 'STORE_DIRECT',
  CREDIT_CARD: 'CREDIT_CARD',
  STORE_WITH_INTEREST: 'STORE_WITH_INTEREST',
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

// PO Payment Status
export const POPaymentStatus = {
  UNPAID: 'UNPAID',
  DEPOSIT_PAID: 'DEPOSIT_PAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  FULLY_PAID: 'FULLY_PAID',
} as const;

// Receiving Item Status
export const ReceivingItemStatus = {
  PASS: 'PASS',
  REJECT: 'REJECT',
} as const;

// Transfer Status
export const TransferStatus = {
  PENDING: 'PENDING',
  IN_TRANSIT: 'IN_TRANSIT',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
} as const;

// Inspection Score Type
export const InspectionScoreType = {
  PASS_FAIL: 'PASS_FAIL',
  GRADE: 'GRADE',
  SCORE_1_5: 'SCORE_1_5',
  NUMBER: 'NUMBER',
} as const;

// Condition Grade
export const ConditionGrade = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
} as const;

// Signer Type
export const SignerType = {
  CUSTOMER: 'CUSTOMER',
  STAFF: 'STAFF',
} as const;

// Notification Channel
export const NotificationChannel = {
  LINE: 'LINE',
  SMS: 'SMS',
  IN_APP: 'IN_APP',
} as const;

// Repossession Status
export const RepossessionStatus = {
  REPOSSESSED: 'REPOSSESSED',
  UNDER_REPAIR: 'UNDER_REPAIR',
  READY_FOR_SALE: 'READY_FOR_SALE',
  SOLD: 'SOLD',
} as const;

// Stock Adjustment Reason
export const StockAdjustmentReason = {
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
  FOUND: 'FOUND',
  CORRECTION: 'CORRECTION',
  WRITE_OFF: 'WRITE_OFF',
  OTHER: 'OTHER',
} as const;

// Credit Check Status
export const CreditCheckStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
} as const;

// Contract Document Type
export const ContractDocumentType = {
  SIGNED_CONTRACT: 'SIGNED_CONTRACT',
  ID_CARD_COPY: 'ID_CARD_COPY',
  KYC: 'KYC',
  FACEBOOK_PROFILE: 'FACEBOOK_PROFILE',
  FACEBOOK_POST: 'FACEBOOK_POST',
  LINE_PROFILE: 'LINE_PROFILE',
  DEVICE_RECEIPT_PHOTO: 'DEVICE_RECEIPT_PHOTO',
  BANK_STATEMENT: 'BANK_STATEMENT',
  OTHER: 'OTHER',
} as const;

// ============================================================
// THAI LABELS FOR DISPLAY
// ============================================================

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
  contractWorkflow: {
    CREATING: 'กำลังสร้าง',
    PENDING_REVIEW: 'รอตรวจสอบ',
    APPROVED: 'อนุมัติแล้ว',
    REJECTED: 'ปฏิเสธ',
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
  product: {
    PO_RECEIVED: 'รับจาก PO',
    QC_PENDING: 'รอตรวจรับ',
    PHOTO_PENDING: 'รอถ่ายรูป',
    INSPECTION: 'กำลังตรวจ',
    IN_STOCK: 'พร้อมขาย',
    RESERVED: 'จอง',
    SOLD_INSTALLMENT: 'ขายผ่อน',
    SOLD_CASH: 'ขายสด',
    REPOSSESSED: 'ยึดคืน',
    REFURBISHED: 'ซ่อมแล้ว',
    SOLD_RESELL: 'ขายต่อ',
    DAMAGED: 'เสียหาย',
    LOST: 'สูญหาย',
    WRITTEN_OFF: 'ตัดจำหน่าย',
  },
  category: {
    PHONE_NEW: 'มือถือใหม่',
    PHONE_USED: 'มือถือมือสอง',
    TABLET: 'แท็บเล็ต',
    ACCESSORY: 'อุปกรณ์เสริม',
  },
  saleType: {
    CASH: 'เงินสด',
    INSTALLMENT: 'ผ่อนกับ BESTCHOICE',
    EXTERNAL_FINANCE: 'ผ่อนไฟแนนซ์',
  },
  po: {
    DRAFT: 'แบบร่าง',
    APPROVED: 'อนุมัติ',
    PENDING: 'รอดำเนินการ',
    PARTIALLY_RECEIVED: 'รับบางส่วน',
    FULLY_RECEIVED: 'รับครบ',
    CANCELLED: 'ยกเลิก',
  },
  poPayment: {
    UNPAID: 'ยังไม่ชำระ',
    DEPOSIT_PAID: 'จ่ายมัดจำ',
    PARTIALLY_PAID: 'ชำระบางส่วน',
    FULLY_PAID: 'ชำระครบ',
  },
  transfer: {
    PENDING: 'รอจัดส่ง',
    IN_TRANSIT: 'ระหว่างโอนสินค้า',
    CONFIRMED: 'รับแล้ว',
    REJECTED: 'ปฏิเสธ',
  },
  repossession: {
    REPOSSESSED: 'ยึดคืน',
    UNDER_REPAIR: 'กำลังซ่อม',
    READY_FOR_SALE: 'พร้อมขาย',
    SOLD: 'ขายแล้ว',
  },
  creditCheck: {
    PENDING: 'รอตรวจสอบ',
    APPROVED: 'ผ่าน',
    REJECTED: 'ไม่ผ่าน',
    MANUAL_REVIEW: 'รอพิจารณา',
  },
  stockAdjustment: {
    DAMAGED: 'เสียหาย',
    LOST: 'สูญหาย',
    FOUND: 'พบสินค้า',
    CORRECTION: 'แก้ไขข้อมูล',
    WRITE_OFF: 'ตัดจำหน่าย',
    OTHER: 'อื่นๆ',
  },
  conditionGrade: {
    A: 'เกรด A (ดีมาก)',
    B: 'เกรด B (ดี)',
    C: 'เกรด C (พอใช้)',
    D: 'เกรด D (ต้องซ่อม)',
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
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
} as const;
