export type ShippingMethod =
  | 'BRANCH_PICKUP'
  | 'KERRY'
  | 'FLASH'
  | 'JT_EXPRESS'
  | 'THAILAND_POST';

export interface ShippingQuote {
  method: ShippingMethod;
  label: string;
  fee: number;
  etaDays: string;
  available: boolean;
}

export interface ShippingAddress {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
}
