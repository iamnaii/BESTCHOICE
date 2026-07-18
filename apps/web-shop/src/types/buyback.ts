export type BuybackStatus =
  | 'PENDING_APPRAISAL'
  | 'APPRAISED'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'REJECTED';

export interface BuybackCatalog {
  models: Array<{
    model: string;
    storages: Array<{ storage: string; maxPrice: string }>;
  }>;
}

export interface BuybackChoice {
  id: string;
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: string;
}

export interface BuybackQuestion {
  id: string;
  key: string;
  title: string;
  helpText: string | null;
  selectType: 'SINGLE' | 'MULTI';
  choices: BuybackChoice[];
}

export interface BuybackQuestionsResponse {
  bonusPct: string;
  questions: BuybackQuestion[];
}

export interface BuybackBreakdownLine {
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: string;
  amount: string;
}

export interface BuybackBreakdown {
  maxPrice: string;
  fixedTotal: string;
  pctTotal: string;
  price: string;
  lines: BuybackBreakdownLine[];
  cashPrice?: string;
  exchangePrice?: string;
  bonusPct?: string;
  chosenFlow?: 'BUYBACK' | 'EXCHANGE';
}

export interface BuybackQuoteResult {
  available: boolean;
  model?: string;
  storage?: string;
  price?: string;
  maxPrice?: string;
  grade?: 'A' | 'B' | 'C' | 'D';
  breakdown?: BuybackBreakdown;
  cashPrice?: string;
  exchangePrice?: string;
  bonusPct?: string;
}

export interface BuybackSubmitResponse {
  id: string;
  status: BuybackStatus;
  price: string;
}

export interface Buyback {
  id: string;
  status: BuybackStatus;
  flow: 'BUYBACK' | 'EXCHANGE';
  deviceBrand: string;
  deviceModel: string;
  deviceStorage: string | null;
  deviceCondition: 'A' | 'B' | 'C' | 'D' | null;
  batteryHealth: number | null;
  notes?: string | null;
  photoUrls: string[];
  estimatedValue?: number | string | null;
  quoteBreakdown?: BuybackBreakdown | null;
  preferredVisitDate?: string | null;
  offeredPrice?: number | string | null;
  agreedPrice?: number | string | null;
  createdAt: string;
}
