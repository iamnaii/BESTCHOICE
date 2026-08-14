export type EquityTxnType =
  | 'CAP_INIT'
  | 'CAP_INC'
  | 'CAP_DEC'
  | 'DRAW'
  | 'DIV_DEC'
  | 'DIV_PAY'
  | 'PRIOR_ADJ';
export type EquityDocStatus = 'DRAFT' | 'READY' | 'POSTED' | 'REVERSED';
export type ShareholderType = 'INDIVIDUAL' | 'JURISTIC_TH' | 'JURISTIC_FOREIGN';

export interface Shareholder {
  id: string;
  name: string;
  taxId: string | null;
  shares: number;
  sharePct: string | null;
  type: ShareholderType;
  note: string | null;
  isActive: boolean;
}

export interface EquityLine {
  id: string;
  shareholderId: string;
  shareholderName: string;
  lineNo: number;
  amount: string;
  premium: string;
  paid: string;
  wht: string;
}

export interface EquityAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface EquityDocument {
  id: string;
  docNumber: string;
  txnType: EquityTxnType;
  status: EquityDocStatus;
  txnDate: string;
  description: string | null;
  resolutionNo: string | null;
  resolutionDate: string | null;
  paymentAccountCode: string | null;
  paAccountCode: string | null;
  paAmount: string | null;
  paDirection: 'DR_OTHER_CR_RE' | 'DR_RE_CR_OTHER' | null;
  journalEntryId: string | null;
  reverseJournalEntryId: string | null;
  reverseReason: string | null;
  postedAt: string | null;
  createdAt: string;
  lines: EquityLine[];
  attachments: EquityAttachment[];
  warning?: string | null;
}

export interface EquityLineInput {
  shareholderId: string;
  amount: number;
  premium?: number;
  paid?: number;
  wht?: number;
}

export interface EquityFormValues {
  txnType: EquityTxnType;
  txnDate: string;
  description?: string;
  resolutionNo?: string;
  resolutionDate?: string;
  paymentAccountCode?: string;
  paAccountCode?: string;
  paAmount?: number;
  paDirection?: string;
  lines: EquityLineInput[];
}

export interface JournalPreview {
  lines: {
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
    description: string;
  }[];
  resolvedLines: {
    shareholderId: string;
    shareholderName: string;
    amount: string;
    premium: string;
    paid: string;
    wht: string;
  }[];
}

export interface DividendRegisterRow {
  shareholderId: string;
  name: string;
  taxId: string | null;
  type: ShareholderType;
  payCount: number;
  gross: string;
  wht: string;
  net: string;
  docNumbers: string[];
}
