export type TradeInSubmissionSource = 'OFFLINE' | 'ONLINE';
export type TradeInFlow = 'EXCHANGE' | 'BUYBACK';

export interface TradeIn {
  id: string;
  status: string;
  deviceBrand: string;
  deviceModel: string;
  deviceStorage: string | null;
  deviceColor?: string | null;
  deviceCondition: string | null;
  imei: string | null;
  estimatedValue: number | null;
  offeredPrice: number | null;
  agreedPrice: number | null;
  sellerName: string | null;
  sellerPhone: string | null;
  voucherNumber: string | null;
  voucherPdfUrl: string | null;
  createdAt: string;
  idCardVerifiedAt?: string | null;
  paymentMethod?: 'CASH' | 'TRANSFER' | null;
  submissionSource?: TradeInSubmissionSource;
  flow?: TradeInFlow;
  customer: { id: string; name: string } | null;
  branch?: { id: string; name: string } | null;
  appraisedBy?: { id: string; name: string } | null;
  idCardVerifiedBy?: { id: string; name: string } | null;

  // Instant-quote (buyback ออนไลน์)
  batteryHealth?: number | null;
  photoUrls?: string[];
  customerNotes?: string | null;
  preferredVisitDate?: string | null;
  conditionAnswers?: Array<{
    questionKey: string;
    title: string;
    selectType: 'SINGLE' | 'MULTI';
    choices: Array<{ choiceId: string; label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: string }>;
  }> | null;
  quoteBreakdown?: {
    maxPrice: string;
    fixedTotal: string;
    pctTotal: string;
    price: string;
    lines: Array<{ label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: string; amount: string }>;
    cashPrice?: string;
    exchangePrice?: string;
    bonusPct?: string;
    chosenFlow?: 'BUYBACK' | 'EXCHANGE';
  } | null;
}

export interface TradeInsResponse {
  data: TradeIn[];
  total: number;
  page: number;
  limit: number;
}

export interface AcceptFormState {
  idCardVerified: boolean;
  sellerConsentSigned: boolean;
  policeReportAcknowledged: boolean;
  paymentMethod: 'CASH' | 'TRANSFER';
  transferBankName: string;
  transferAccountNumber: string;
  transferAccountName: string;
  sellerSignatureBase64: string;
}

export const EMPTY_ACCEPT_FORM: AcceptFormState = {
  idCardVerified: false,
  sellerConsentSigned: false,
  policeReportAcknowledged: false,
  paymentMethod: 'CASH',
  transferBankName: '',
  transferAccountNumber: '',
  transferAccountName: '',
  sellerSignatureBase64: '',
};
