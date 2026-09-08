export interface BuybackChoice {
  id: string;
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: string;
  helpText?: string | null;
  isNoneChoice?: boolean;
}

export type BuybackPricingMode = 'SUM_PERCENT_FLOOR10' | 'MAX_PERCENT_EXACT';

export interface BuybackReferenceMetadata {
  pricingMode?: BuybackPricingMode;
  source?: string;
  capturedAt?: string;
  profileId?: string;
  eligibilityRequired?: boolean;
  eligibilityText?: string;
}

export interface BuybackQuestion {
  id: string;
  key: string;
  title: string;
  helpText: string | null;
  selectType: 'SINGLE' | 'MULTI';
  choices: BuybackChoice[];
}

export interface BuybackQuestionsResponse extends BuybackReferenceMetadata {
  bonusPct: string;
  questions: BuybackQuestion[];
}

export interface BuybackAnswer {
  questionKey: string;
  choiceIds: string[];
}

export interface BuybackBreakdownLine {
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: string;
  amount: string;
  applied?: boolean;
}

export interface BuybackBreakdown extends BuybackReferenceMetadata {
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

export interface BuybackQuoteResult extends BuybackReferenceMetadata {
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
