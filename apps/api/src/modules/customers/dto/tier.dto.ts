export type CustomerTier = 'GOLD' | 'GOOD' | 'NEW' | 'RISKY' | 'BLACKLIST';

export interface TierReason {
  code: string;
  message: string;
}

export interface CustomerTierResponse {
  customerId: string;
  tier: CustomerTier;
  reasons: TierReason[];
  history: {
    totalContracts: number;
    closedContracts: number;
    activeContracts: number;
    onTimePaymentPct: number; // 0-100
    onTimePayments: number;
    latePayments: number;
    maxOverdueDays: number;
    currentOutstanding: number;
    hasBadDebt: boolean;
    hasRepossession: boolean;
  };
}
