import type { ShippingAddress, ShippingMethod } from './shipping';

export type PaymentChannel = 'PROMPTPAY_QR' | 'CREDIT_DEBIT_CARD' | 'BANK_TRANSFER';

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_PAYMENT'
  | 'PENDING_BANK_REVIEW'
  | 'PAID'
  | 'PACKING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface OnlineOrder {
  id: string;
  orderNumber: string;
  productPrice: number;
  shippingFee: number;
  promoCode: string | null;
  promoDiscount: number;
  loyaltyPointsUsed: number;
  loyaltyDiscount: number;
  totalAmount: number;
  shippingMethod: ShippingMethod;
  shippingAddress: ShippingAddress | null;
  trackingNumber: string | null;
  paymentChannel: PaymentChannel;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  status: OrderStatus;
  createdAt: string;
  product: { id: string; name: string; gallery: string[] };
}
