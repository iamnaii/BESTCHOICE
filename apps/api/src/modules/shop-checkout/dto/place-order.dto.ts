import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  IsObject,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ShippingMethod } from '../../shop-shipping/shop-shipping.types';

export enum PaymentChannel {
  PROMPTPAY_QR = 'PROMPTPAY_QR',
  CREDIT_DEBIT_CARD = 'CREDIT_DEBIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

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

export class PlaceOrderDto {
  @IsUUID() reservationId!: string;
  @IsEnum(ShippingMethod) shippingMethod!: ShippingMethod;
  @IsObject() @ValidateNested() @Type(() => ShippingAddressDto) shippingAddress!: ShippingAddressDto;
  @IsEnum(PaymentChannel) paymentChannel!: PaymentChannel;
  @IsOptional() @IsString() promoCode?: string;
  @IsOptional() @IsInt() @Min(0) loyaltyPointsRedeemed?: number;
}
