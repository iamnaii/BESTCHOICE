// ─── LIFF API Response Types ──────────────────────────
// Shared between backend (response shape) and frontend (data consumption).
// Keep in sync with LiffApiService + LiffApiController.

/** Single installment payment within a contract */
export interface LiffPayment {
  installmentNo: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  lateFee: number;
  status: string;
  paidDate: string | null;
  paymentMethod: string | null;
}

/** Contract summary returned by GET /line-oa/liff/contracts */
export interface LiffContract {
  id: string;
  contractNumber: string;
  status: string;
  product: string;
  sellingPrice: number;
  downPayment: number;
  monthlyPayment: number;
  totalMonths: number;
  paidInstallments: number;
  totalOutstanding: number;
  createdAt: string;
  payments: LiffPayment[];
}

/** Top-level response for GET /line-oa/liff/contracts */
export interface LiffContractResponse {
  customer: { name: string };
  contracts: LiffContract[];
}

/** Single payment in history list */
export interface LiffHistoryPayment {
  contractNumber: string;
  installmentNo: number;
  amountPaid: number;
  paidDate: string | null;
  paymentMethod: string | null;
  lateFee: number;
  /** Receipt ID if an issued, non-voided receipt exists for this payment —
   * used by the LIFF history UI to surface an inline PDF download link.
   * Null when no receipt has been generated yet. */
  receiptId: string | null;
}

/** Response for GET /line-oa/liff/history */
export interface LiffHistoryResponse {
  customer: { name: string };
  payments: LiffHistoryPayment[];
}

/** Response for GET /line-oa/liff/profile */
export interface LiffProfileResponse {
  name: string;
  phone: string;
  lineDisplayName: string;
  contractCount: number;
  totalPoints: number;
}

/** Response for GET /line-oa/liff/early-payoff-quote */
export interface LiffEarlyPayoffQuote {
  remainingMonths: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discount: number;
  partiallyPaidCredit: number;
  unpaidLateFees: number;
  totalPayoff: number;
  contractNumber: string;
  customerName: string;
}

/** Response for POST /line-oa/liff/register/lookup */
export interface LiffRegisterLookupResponse {
  customerId: string;
  maskedName: string;
}

/** Payment link data resolved by GET /line-oa/pay/:token */
export interface LiffPaymentLinkData {
  valid: boolean;
  token: string;
  amount: number;
  status: string;
  expiresAt: string;
  contract: {
    id: string;
    contractNumber: string;
    customer: { name: string };
  };
  payment: {
    installmentNo: number;
    amountDue: number;
    lateFee: number;
    dueDate: string;
  } | null;
  promptPay?: {
    qrDataUrl: string | null;
    accountName: string;
    maskedId: string;
  };
}

/** Response for POST /line-oa/liff/create-payment-link or early-payoff */
export interface LiffPaymentLinkResult {
  url: string;
  token: string;
  totalPayoff?: number;
}
