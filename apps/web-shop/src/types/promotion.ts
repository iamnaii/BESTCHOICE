export type ShopPromotionType =
  | 'PERCENTAGE_DISCOUNT'
  | 'FIXED_DISCOUNT'
  | 'FREE_ACCESSORY'
  | 'SPECIAL_RATE';

export interface ShopPromotion {
  id: string;
  name: string;
  description: string | null;
  type: ShopPromotionType;
  /** Prisma Decimal serializes as string over JSON */
  discountValue: string | number | null;
  specialInterestRate: string | number | null;
  conditions: {
    minPurchase?: number;
    productIds?: string[];
    categories?: string[];
  } | null;
  startDate: string;
  endDate: string;
}
