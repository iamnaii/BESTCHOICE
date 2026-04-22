export type BuybackStatus =
  | 'PENDING_APPRAISAL'
  | 'APPRAISED'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'REJECTED';

export interface BuybackEstimate {
  min: number;
  max: number;
  available: boolean;
}

export interface BuybackSubmitResponse {
  id: string;
  status: BuybackStatus;
  etaHours: number;
}

export interface Buyback {
  id: string;
  status: BuybackStatus;
  deviceBrand: string;
  deviceModel: string;
  deviceStorage: string;
  deviceCondition: 'A' | 'B' | 'C';
  batteryHealth: number;
  imei?: string | null;
  notes?: string | null;
  photoUrls: string[];
  offeredPrice?: number | string | null;
  agreedPrice?: number | string | null;
  sellerName: string;
  sellerPhone: string;
  lineUserId?: string | null;
  createdAt: string;
  updatedAt: string;
}
