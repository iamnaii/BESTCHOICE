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
  customer: { id: string; name: string } | null;
  branch?: { id: string; name: string } | null;
  appraisedBy?: { id: string; name: string } | null;
  idCardVerifiedBy?: { id: string; name: string } | null;
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
