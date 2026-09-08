export const REFERENCE_PRICING_CONFIG_KEY = 'sell_reference_pricing_v1';

export type BuybackPricingMode = 'SUM_PERCENT_FLOOR10' | 'MAX_PERCENT_EXACT';

export interface ReferencePricingMetadata {
  pricingMode: BuybackPricingMode;
  eligibilityRequired: boolean;
  source?: string;
  capturedAt?: string;
  profileId?: string;
  eligibilityText?: string;
}

export interface ReferencePricingChoice {
  id: string;
  label: string;
  deductType: 'FIXED' | 'PERCENT';
  deductValue: string;
  helpText?: string | null;
  isNoneChoice?: boolean;
}

export interface ReferencePricingQuestion {
  id: string;
  key: string;
  title: string;
  helpText?: string | null;
  selectType: 'SINGLE' | 'MULTI';
  choices: ReferencePricingChoice[];
}

export interface ReferencePricingProfile {
  pricingMode: 'MAX_PERCENT_EXACT';
  eligibilityRequired: true;
  eligibilityText: string;
  questions: ReferencePricingQuestion[];
}

export interface ReferencePricingCatalog {
  version: 1;
  source: string;
  capturedAt: string;
  profiles: Record<string, ReferencePricingProfile>;
  assignments: Array<{ model: string; storage: string; profileId: string }>;
}
