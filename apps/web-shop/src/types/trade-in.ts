export type TradeInStatus =
  | 'PENDING_APPRAISAL'
  | 'APPRAISED'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'REJECTED';

export interface TradeInEstimate {
  min: number;
  max: number;
  available: boolean;
}

export interface TradeInSubmitResponse {
  id: string;
  status: TradeInStatus;
  etaHours: number;
}

export interface TradeIn {
  id: string;
  status: TradeInStatus;
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
  targetProductId?: string | null;
  createdAt: string;
  updatedAt: string;
}
