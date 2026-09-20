import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TenderInputDto } from '../../shop-tenders/dto/tender-input.dto';
import { MAX_TENDERS } from '../../shop-tenders/shop-tender.util';

import { BOOKING_PAYMENT_METHODS, DepositMethod } from './pay-deposit.dto';

/**
 * Convert a PAID booking into a Sale row. The booking's depositAmount transfers
 * to Sale.downPaymentAmount automatically.
 * Supports CASH with exactly one linked physical product, quantity one.
 *
 * `collectBalance` is mandatory when `depositAmount < totalAmount`:
 *   - true  → cashier confirms collecting (totalAmount - depositAmount) at the
 *             counter; Sale.amountReceived = totalAmount (paid in full).
 *   - false → reject the convert; partial-payment bookings must collect the
 *             balance before becoming a Sale.
 *
 * When depositAmount === totalAmount (full prepay), `collectBalance` is
 * irrelevant — Sale.amountReceived = depositAmount = totalAmount.
 */
export class ConvertBookingDto {
  @IsOptional()
  @IsBoolean()
  previouslyDamagedAcknowledged?: boolean;

  @IsOptional()
  @IsEnum(['CASH'], {
    message: 'รองรับเฉพาะ CASH ในเฟสนี้ — ผ่อน/ไฟแนนซ์ภายนอกค่อยทำเฟสถัดไป',
  })
  saleType?: 'CASH';

  @IsOptional()
  @IsIn(BOOKING_PAYMENT_METHODS, { message: 'กรุณาเลือกวิธีรับส่วนต่างเป็นเงินสด โอนธนาคาร หรือ QR / e-Wallet' })
  paymentMethod?: DepositMethod;

  @IsOptional()
  @IsBoolean({ message: 'collectBalance ต้องเป็น true/false' })
  collectBalance?: boolean;

  /** ช่องรับเงินของส่วนที่เหลือ (จ่ายผสมได้ โอน/QR บังคับเลขอ้างอิง) — ผลรวมต้องเท่ายอดส่วนต่างพอดี */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TENDERS)
  @ValidateNested({ each: true })
  @Type(() => TenderInputDto)
  tenders?: TenderInputDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
