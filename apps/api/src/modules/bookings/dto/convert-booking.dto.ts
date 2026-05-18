import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Convert a PAID booking into a Sale row. The booking's depositAmount transfers
 * to Sale.downPaymentAmount automatically.
 * Phase 1: supports CASH only (takes the first item's productId as the Sale's
 * product anchor — matches the SP5 Quote→Sale convention).
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
  @IsEnum(['CASH'], {
    message: 'รองรับเฉพาะ CASH ในเฟสนี้ — ผ่อน/ไฟแนนซ์ภายนอกค่อยทำเฟสถัดไป',
  })
  saleType?: 'CASH';

  @IsOptional()
  @IsString({ message: 'paymentMethod ต้องเป็น string' })
  paymentMethod?: string;

  @IsOptional()
  @IsBoolean({ message: 'collectBalance ต้องเป็น true/false' })
  collectBalance?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
