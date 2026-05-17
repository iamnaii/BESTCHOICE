import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Convert an ACCEPTED quote into a Sale row.
 * Phase 1: support CASH only (SHOP-side ขายสด from the first quote item).
 * INSTALLMENT/EXTERNAL_FINANCE conversion is deferred to SP6 (would need
 * additional fields: downPayment, totalMonths, financeCompany, etc.).
 */
export class ConvertQuoteDto {
  @IsOptional()
  @IsEnum(['CASH'], {
    message: 'รองรับเฉพาะ CASH ในเฟสนี้ — ผ่อน/ไฟแนนซ์ภายนอกค่อยทำใน SP6',
  })
  saleType?: 'CASH';

  @IsOptional()
  @IsString({ message: 'paymentMethod ต้องเป็น string' })
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
