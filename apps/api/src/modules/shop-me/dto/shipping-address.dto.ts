import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * ที่อยู่จัดส่งในสมุดที่อยู่ของลูกค้า (`customer.shippingAddresses`)
 * ย้ายมาจาก `shop-checkout/dto/place-order.dto.ts` ตอนถอดระบบสั่งซื้อออนไลน์ 2026-09-28
 * — สมุดที่อยู่ (/account/addresses บนเว็บลูกค้า) ยังใช้อยู่
 */
export class ShippingAddressDto {
  @IsString() @IsNotEmpty() recipientName!: string;
  @IsString() @IsNotEmpty() phone!: string;
  @IsString() @IsNotEmpty() line1!: string;
  @IsOptional() @IsString() line2?: string;
  @IsString() @IsNotEmpty() subDistrict!: string;
  @IsString() @IsNotEmpty() district!: string;
  @IsString() @IsNotEmpty() province!: string;
  @IsString() @IsNotEmpty() postalCode!: string;
}
