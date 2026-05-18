import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Convert a PAID booking into a Sale row. The booking's depositAmount transfers
 * to Sale.downPaymentAmount automatically.
 * Phase 1: supports CASH only (takes the first item's productId as the Sale's
 * product anchor — matches the SP5 Quote→Sale convention).
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
  @IsString()
  notes?: string;
}
