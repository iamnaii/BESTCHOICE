export declare const UserRole: {
    readonly SALES: "SALES";
    readonly BRANCH_MANAGER: "BRANCH_MANAGER";
    readonly ACCOUNTANT: "ACCOUNTANT";
    readonly FINANCE_MANAGER: "FINANCE_MANAGER";
    readonly OWNER: "OWNER";
};
export declare const ContractStatus: {
    readonly DRAFT: "DRAFT";
    readonly ACTIVE: "ACTIVE";
    readonly OVERDUE: "OVERDUE";
    readonly DEFAULT: "DEFAULT";
    readonly EARLY_PAYOFF: "EARLY_PAYOFF";
    readonly COMPLETED: "COMPLETED";
    readonly EXCHANGED: "EXCHANGED";
    readonly CLOSED_BAD_DEBT: "CLOSED_BAD_DEBT";
};
export declare const ContractWorkflowStatus: {
    readonly CREATING: "CREATING";
    readonly PENDING_REVIEW: "PENDING_REVIEW";
    readonly APPROVED: "APPROVED";
    readonly REJECTED: "REJECTED";
};
export declare const ProductStatus: {
    readonly PO_RECEIVED: "PO_RECEIVED";
    readonly QC_PENDING: "QC_PENDING";
    readonly PHOTO_PENDING: "PHOTO_PENDING";
    readonly INSPECTION: "INSPECTION";
    readonly IN_STOCK: "IN_STOCK";
    readonly RESERVED: "RESERVED";
    readonly SOLD_INSTALLMENT: "SOLD_INSTALLMENT";
    readonly SOLD_CASH: "SOLD_CASH";
    readonly REPOSSESSED: "REPOSSESSED";
    readonly REFURBISHED: "REFURBISHED";
    readonly SOLD_RESELL: "SOLD_RESELL";
    readonly DAMAGED: "DAMAGED";
    readonly LOST: "LOST";
    readonly WRITTEN_OFF: "WRITTEN_OFF";
};
export declare const PaymentMethod: {
    readonly CASH: "CASH";
    readonly BANK_TRANSFER: "BANK_TRANSFER";
    readonly QR_EWALLET: "QR_EWALLET";
    readonly CREDIT_BALANCE: "CREDIT_BALANCE";
    readonly ONLINE_GATEWAY: "ONLINE_GATEWAY";
};
export declare const PlanType: {
    readonly STORE_DIRECT: "STORE_DIRECT";
    readonly CREDIT_CARD: "CREDIT_CARD";
    readonly STORE_WITH_INTEREST: "STORE_WITH_INTEREST";
};
export declare const ProductCategory: {
    readonly PHONE_NEW: "PHONE_NEW";
    readonly PHONE_USED: "PHONE_USED";
    readonly TABLET: "TABLET";
    readonly ACCESSORY: "ACCESSORY";
};
export declare const PaymentStatus: {
    readonly PENDING: "PENDING";
    readonly PAID: "PAID";
    readonly PARTIALLY_PAID: "PARTIALLY_PAID";
    readonly OVERDUE: "OVERDUE";
};
export declare const SaleType: {
    readonly CASH: "CASH";
    readonly INSTALLMENT: "INSTALLMENT";
    readonly EXTERNAL_FINANCE: "EXTERNAL_FINANCE";
};
export declare const POStatus: {
    readonly DRAFT: "DRAFT";
    readonly APPROVED: "APPROVED";
    readonly PENDING: "PENDING";
    readonly PARTIALLY_RECEIVED: "PARTIALLY_RECEIVED";
    readonly FULLY_RECEIVED: "FULLY_RECEIVED";
    readonly CANCELLED: "CANCELLED";
};
export declare const POPaymentStatus: {
    readonly UNPAID: "UNPAID";
    readonly DEPOSIT_PAID: "DEPOSIT_PAID";
    readonly PARTIALLY_PAID: "PARTIALLY_PAID";
    readonly FULLY_PAID: "FULLY_PAID";
};
export declare const ReceivingItemStatus: {
    readonly PASS: "PASS";
    readonly REJECT: "REJECT";
};
export declare const TransferStatus: {
    readonly PENDING: "PENDING";
    readonly IN_TRANSIT: "IN_TRANSIT";
    readonly CONFIRMED: "CONFIRMED";
    readonly REJECTED: "REJECTED";
};
export declare const InspectionScoreType: {
    readonly PASS_FAIL: "PASS_FAIL";
    readonly GRADE: "GRADE";
    readonly SCORE_1_5: "SCORE_1_5";
    readonly NUMBER: "NUMBER";
};
export declare const ConditionGrade: {
    readonly A: "A";
    readonly B: "B";
    readonly C: "C";
    readonly D: "D";
};
export declare const SignerType: {
    readonly CUSTOMER: "CUSTOMER";
    readonly STAFF: "STAFF";
};
export declare const NotificationChannel: {
    readonly LINE: "LINE";
    readonly SMS: "SMS";
    readonly IN_APP: "IN_APP";
};
export declare const RepossessionStatus: {
    readonly REPOSSESSED: "REPOSSESSED";
    readonly UNDER_REPAIR: "UNDER_REPAIR";
    readonly READY_FOR_SALE: "READY_FOR_SALE";
    readonly SOLD: "SOLD";
};
export declare const StockAdjustmentReason: {
    readonly DAMAGED: "DAMAGED";
    readonly LOST: "LOST";
    readonly FOUND: "FOUND";
    readonly CORRECTION: "CORRECTION";
    readonly WRITE_OFF: "WRITE_OFF";
    readonly OTHER: "OTHER";
};
export declare const CreditCheckStatus: {
    readonly PENDING: "PENDING";
    readonly APPROVED: "APPROVED";
    readonly REJECTED: "REJECTED";
    readonly MANUAL_REVIEW: "MANUAL_REVIEW";
};
export declare const ContractDocumentType: {
    readonly SIGNED_CONTRACT: "SIGNED_CONTRACT";
    readonly ID_CARD_COPY: "ID_CARD_COPY";
    readonly KYC: "KYC";
    readonly FACEBOOK_PROFILE: "FACEBOOK_PROFILE";
    readonly FACEBOOK_POST: "FACEBOOK_POST";
    readonly LINE_PROFILE: "LINE_PROFILE";
    readonly DEVICE_RECEIPT_PHOTO: "DEVICE_RECEIPT_PHOTO";
    readonly BANK_STATEMENT: "BANK_STATEMENT";
    readonly OTHER: "OTHER";
};
export declare const STATUS_LABELS: {
    readonly contract: {
        readonly DRAFT: "แบบร่าง";
        readonly ACTIVE: "ปกติ";
        readonly OVERDUE: "ค้างชำระ";
        readonly DEFAULT: "ผิดนัด";
        readonly EARLY_PAYOFF: "ปิดก่อนกำหนด";
        readonly COMPLETED: "ปิดสัญญา";
        readonly EXCHANGED: "เปลี่ยนเครื่อง";
        readonly CLOSED_BAD_DEBT: "หนี้สูญ";
    };
    readonly contractWorkflow: {
        readonly CREATING: "กำลังสร้าง";
        readonly PENDING_REVIEW: "รอตรวจสอบ";
        readonly APPROVED: "อนุมัติแล้ว";
        readonly REJECTED: "ปฏิเสธ";
    };
    readonly payment: {
        readonly PENDING: "รอชำระ";
        readonly PAID: "ชำระแล้ว";
        readonly PARTIALLY_PAID: "ชำระบางส่วน";
        readonly OVERDUE: "ค้างชำระ";
    };
    readonly paymentMethod: {
        readonly CASH: "เงินสด";
        readonly BANK_TRANSFER: "โอนธนาคาร";
        readonly QR_EWALLET: "QR/E-Wallet";
        readonly CREDIT_BALANCE: "เครดิตคงเหลือ";
        readonly ONLINE_GATEWAY: "ชำระออนไลน์";
    };
    readonly product: {
        readonly PO_RECEIVED: "รับจาก PO";
        readonly QC_PENDING: "รอตรวจรับ";
        readonly PHOTO_PENDING: "รอถ่ายรูป";
        readonly INSPECTION: "กำลังตรวจ";
        readonly IN_STOCK: "พร้อมขาย";
        readonly RESERVED: "จอง";
        readonly SOLD_INSTALLMENT: "ขายผ่อน";
        readonly SOLD_CASH: "ขายสด";
        readonly REPOSSESSED: "ยึดคืน";
        readonly REFURBISHED: "ซ่อมแล้ว";
        readonly SOLD_RESELL: "ขายต่อ";
        readonly DAMAGED: "เสียหาย";
        readonly LOST: "สูญหาย";
        readonly WRITTEN_OFF: "ตัดจำหน่าย";
    };
    readonly category: {
        readonly PHONE_NEW: "มือถือใหม่";
        readonly PHONE_USED: "มือถือมือสอง";
        readonly TABLET: "แท็บเล็ต";
        readonly ACCESSORY: "อุปกรณ์เสริม";
    };
    readonly saleType: {
        readonly CASH: "เงินสด";
        readonly INSTALLMENT: "ผ่อนกับ BESTCHOICE";
        readonly EXTERNAL_FINANCE: "ผ่อนไฟแนนซ์";
    };
    readonly po: {
        readonly DRAFT: "แบบร่าง";
        readonly APPROVED: "อนุมัติ";
        readonly PENDING: "รอดำเนินการ";
        readonly PARTIALLY_RECEIVED: "รับบางส่วน";
        readonly FULLY_RECEIVED: "รับครบ";
        readonly CANCELLED: "ยกเลิก";
    };
    readonly poPayment: {
        readonly UNPAID: "ยังไม่ชำระ";
        readonly DEPOSIT_PAID: "จ่ายมัดจำ";
        readonly PARTIALLY_PAID: "ชำระบางส่วน";
        readonly FULLY_PAID: "ชำระครบ";
    };
    readonly transfer: {
        readonly PENDING: "รอจัดส่ง";
        readonly IN_TRANSIT: "ระหว่างโอนสินค้า";
        readonly CONFIRMED: "รับแล้ว";
        readonly REJECTED: "ปฏิเสธ";
    };
    readonly repossession: {
        readonly REPOSSESSED: "ยึดคืน";
        readonly UNDER_REPAIR: "กำลังซ่อม";
        readonly READY_FOR_SALE: "พร้อมขาย";
        readonly SOLD: "ขายแล้ว";
    };
    readonly creditCheck: {
        readonly PENDING: "รอตรวจสอบ";
        readonly APPROVED: "ผ่าน";
        readonly REJECTED: "ไม่ผ่าน";
        readonly MANUAL_REVIEW: "รอพิจารณา";
    };
    readonly stockAdjustment: {
        readonly DAMAGED: "เสียหาย";
        readonly LOST: "สูญหาย";
        readonly FOUND: "พบสินค้า";
        readonly CORRECTION: "แก้ไขข้อมูล";
        readonly WRITE_OFF: "ตัดจำหน่าย";
        readonly OTHER: "อื่นๆ";
    };
    readonly conditionGrade: {
        readonly A: "เกรด A (ดีมาก)";
        readonly B: "เกรด B (ดี)";
        readonly C: "เกรด C (พอใช้)";
        readonly D: "เกรด D (ต้องซ่อม)";
    };
};
export declare const DEFAULT_CONFIG: {
    readonly INTEREST_RATE: 0.08;
    readonly MIN_DOWN_PAYMENT_PCT: 0.15;
    readonly LATE_FEE_PER_DAY: 100;
    readonly LATE_FEE_CAP: 200;
    readonly EARLY_PAYOFF_DISCOUNT: 0.5;
    readonly MIN_INSTALLMENT_MONTHS: 6;
    readonly MAX_INSTALLMENT_MONTHS: 12;
    readonly MAX_FILE_SIZE_BYTES: number;
};
