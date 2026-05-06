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
