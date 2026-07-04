export interface OcrPaymentSlipResult {
  amount: number | null;
  senderName: string | null;
  senderBank: string | null;
  senderAccountNo: string | null;
  receiverName: string | null;
  receiverBank: string | null;
  receiverAccountNo: string | null;
  transactionRef: string | null;
  transactionDate: string | null;
  transactionTime: string | null;
  slipType: string | null;
  confidence: number;
}

export interface PendingPayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  lateFee: string;
  status: string;
  /** Set once the installment is PAID — used by the ชำระครบ tab. */
  paidDate?: string | null;
  /** Free-text stamps from record flows — '[ปิดก่อนกำหนด]', 'ใช้เครดิต X บาท' explain
   *  why a PAID row's ชำระแล้ว can be partial or '-'. */
  notes?: string | null;
  monthlyPrincipal: string | null;
  monthlyInterest: string | null;
  monthlyCommission: string | null;
  vatAmount: string | null;
  contract: {
    id: string;
    contractNumber: string;
    totalMonths: number;
    monthlyPayment: string;
    advanceBalance: string;  // serialized Decimal from API — '0' for most contracts
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
}

export interface DailySummaryPayment {
  id: string;
  installmentNo: number;
  amountPaid: string;
  paymentMethod: string;
  paidDate: string | null;
  contract?: { contractNumber: string; customer?: { name: string } };
  recordedBy?: { name: string } | null;
}

export interface DailySummary {
  date: string;
  totalPayments: number;
  totalAmount: number;
  totalLateFees: number;
  byMethod: Record<string, number>;
  data: DailySummaryPayment[];
}

/** KPI summary for the payment-queue header — whole-system aggregate from
 *  GET /payments/pending-summary, scoped by the selected due-date window. */
export interface PendingSummary {
  /** จำนวนงวดที่ยังค้าง (PENDING/OVERDUE/PARTIALLY_PAID) */
  pendingCount: number;
  /** ยอดรอเก็บ "เฉพาะค่างวด" — Σ(amountDue − amountPaid), ไม่รวมค่าปรับ */
  outstandingPrincipal: number;
  /** ค่าปรับล่าช้าที่ยังรอเก็บ — Σ lateFee (→ Cr 42-1103 เมื่อเก็บได้) */
  outstandingLateFee: number;
  /** ค่าปรับที่อนุโลม (ยกเว้น) — Σ waivedAmount (→ Dr 52-1105 ส่วนลด) */
  waivedLateFee: number;
  /** จำนวนงวดค้าง ≥ 60 วัน (→ trigger 21-2103 VAT บังคับ) */
  overdue60Count: number;
  /** ยอดที่เก็บได้แล้วของงวดในช่วงนี้ — Σ amountPaid */
  collectedAmount: number;
  /** จำนวนรายการที่เก็บได้แล้ว */
  collectedCount: number;
}

/**
 * @deprecated Use `getStatusBadgeProps(status, paymentStatusMap)` from `@/lib/status-badges` instead.
 * Kept for backwards-compat until all callers are migrated.
 */
export const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-muted text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
};

export const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

export const slipTypeLabels: Record<string, string> = {
  BANK_TRANSFER: 'โอนเงิน',
  QR_PAYMENT: 'QR Payment',
  PROMPTPAY: 'พร้อมเพย์',
  OTHER: 'อื่นๆ',
};

export const isSlipRequired = (method: string) => method !== 'CASH';
