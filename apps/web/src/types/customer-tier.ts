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
    onTimePaymentPct: number;
    onTimePayments: number;
    latePayments: number;
    maxOverdueDays: number;
    currentOutstanding: number;
    hasBadDebt: boolean;
    hasRepossession: boolean;
  };
}

export const TIER_LABELS: Record<CustomerTier, string> = {
  GOLD: 'VIP (Gold)',
  GOOD: 'ลูกค้าดี',
  NEW: 'ลูกค้าใหม่',
  RISKY: 'ต้องระวัง',
  BLACKLIST: 'ประวัติเสีย', // ก้อน 5 C3 — คำว่า 'ห้ามทำสัญญา' เป็นของป้าย blacklist (CustomerBlacklistBadge) ไม่ให้สองป้ายขัดกัน
};
