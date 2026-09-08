import type { BuybackBreakdown } from '@installment/shared';

export type TradeInSubmissionSource = 'OFFLINE' | 'ONLINE';
export type TradeInFlow = 'EXCHANGE' | 'BUYBACK';

export interface TradeIn {
  sellerIdCardNumber?: string | null;
  sellerAddress?: string | null;
  imeiMissingReason?: string | null;
  serialNumberMissingReason?: string | null;
  id: string;
  status: string;
  productId?: string | null;
  product?: { id: string; name: string; status: string } | null;
  deviceBrand: string;
  deviceModel: string;
  deviceStorage: string | null;
  deviceColor?: string | null;
  deviceCondition: string | null;
  imei: string | null;
  serialNumber?: string | null;
  estimatedValue: number | null;
  offeredPrice: number | null;
  agreedPrice: number | null;
  sellerName: string | null;
  sellerPhone: string | null;
  voucherNumber: string | null;
  voucherPdfUrl: string | null;
  transferBankName?: string | null;
  transferAccountNumber?: string | null;
  transferAccountName?: string | null;
  sellerConsentSigned?: boolean;
  notes?: string | null;
  creditBaseAmount?: string | number | null;
  creditBonusAmount?: string | number | null;
  creditIssuedAt?: string | null;
  currentRedemptionId?: string | null;
  createdAt: string;
  idCardVerifiedAt?: string | null;
  paymentMethod?: 'CASH' | 'TRANSFER' | 'TRADE_IN_CREDIT' | null;
  submissionSource?: TradeInSubmissionSource;
  flow?: TradeInFlow;
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
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
    choices: Array<{
      choiceId: string;
      label: string;
      deductType: 'PERCENT' | 'FIXED';
      deductValue: string;
    }>;
  }> | null;
  quoteBreakdown?: BuybackBreakdown | null;
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

export type AcceptRequest = Omit<AcceptFormState, 'paymentMethod'> & {
  sellerName?: string;
  sellerPhone?: string;
  sellerIdCardNumber?: string;
  sellerAddress?: string;
  imeiMissingReason?: string;
  serialNumberMissingReason?: string;
  declarationVersion: string;
  imei?: string | null;
  serialNumber?: string | null;
  paymentMethod: 'CASH' | 'TRANSFER' | 'TRADE_IN_CREDIT';
  branchId?: string;
};
