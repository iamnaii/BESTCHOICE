import type { BuybackBreakdown } from '@installment/shared';

export type {
  BuybackAnswer,
  BuybackChoice,
  BuybackQuestion,
  BuybackQuestionsResponse,
  BuybackBreakdownLine,
  BuybackBreakdown,
  BuybackQuoteResult,
} from '@installment/shared';

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
