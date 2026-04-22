export enum ShippingMethod {
  BRANCH_PICKUP = 'BRANCH_PICKUP',
  KERRY = 'KERRY',
  FLASH = 'FLASH',
  JT_EXPRESS = 'JT_EXPRESS',
  THAILAND_POST = 'THAILAND_POST',
}

export interface ShippingQuote {
  method: ShippingMethod;
  label: string;
  fee: number;
  etaDays: string;
  available: boolean;
  note?: string;
}
