export type OtherIncomeStatus = 'DRAFT' | 'POSTED' | 'REVERSED';
export type OtherIncomePriceType = 'EXCLUSIVE' | 'INCLUSIVE';
export type OtherIncomeReverseReason =
  | 'INPUT_ERROR'
  | 'CUSTOMER_REQUEST'
  | 'DUPLICATE'
  | 'WRONG_ACCOUNT'
  | 'WRONG_AMOUNT'
  | 'OTHER';

export interface OtherIncomeItem {
  id: string;
  lineNo: number;
  accountCode: string;
  accountName: string;
  description: string | null;
  quantity: string;
  unitAmount: string;
  discountAmount: string;
  vatPct: string;
  whtPct: string;
  amountBeforeVat: string;
  vatAmount: string;
  whtAmount: string;
}

export interface OtherIncomeAdjustment {
  id: string;
  lineNo: number;
  accountCode: string;
  amount: string;
  note: string | null;
}

export interface OtherIncomeAttachment {
  id: string;
  s3Key: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedById: string;
  createdAt: string;
}

export interface OtherIncome {
  id: string;
  docNumber: string;
  status: OtherIncomeStatus;
  issueDate: string;
  dueDate: string | null;
  paymentDate: string | null;
  priceType: OtherIncomePriceType;
  customerId: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  counterpartyAddress: string | null;
  counterpartyPhone: string | null;
  paymentAccountCode: string;
  amountReceived: string;
  incomeGross: string;
  vatAmount: string;
  whtAmount: string;
  netReceived: string;
  totalAmount: string;
  receiptNo: string | null;
  journalEntryId: string | null;
  isOverridden: boolean;
  customerNote: string | null;
  createdById: string;
  postedAt: string | null;
  reversesId: string | null;
  // Auto-derived inverse of the self-FK `reversesId`; populated by the API when
  // this original doc has been reversed. Not a stored scalar — must be included
  // by the backend via Prisma `include: { reversedBy: { select: ... } }`.
  reversedBy: { id: string; docNumber: string } | null;
  reverseReason: OtherIncomeReverseReason | null;
  reverseNote: string | null;
  copiedFromId: string | null;
  createdAt: string;
  updatedAt: string;
  items: OtherIncomeItem[];
  adjustments: OtherIncomeAdjustment[];
  attachments: OtherIncomeAttachment[];
  customer: { id: string; name: string; phone?: string | null } | null;
}

export interface DailySheet {
  date: string;
  summary: {
    incomeGross: string;
    vat: string;
    wht: string;
    netReceived: string;
    docCount: number;
  };
  docs: OtherIncome[];
  byAccount: Array<{ code: string; name: string; total: string; count: number }>;
  byPayment: Array<{ code: string; total: string; count: number }>;
}

export interface ListResponse {
  data: OtherIncome[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
  oldValue?: unknown;
  newValue?: unknown;
}
