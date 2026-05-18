import { IsEnum, IsOptional, IsString } from 'class-validator';

// Mirror the Prisma PaymentMethod enum. Keep in lockstep with
// apps/api/prisma/schema.prisma `enum PaymentMethod`.
const ALLOWED_METHODS = [
  'CASH',
  'BANK_TRANSFER',
  'QR_EWALLET',
  'CREDIT_BALANCE',
  'ONLINE_GATEWAY',
] as const;
export type DepositMethod = (typeof ALLOWED_METHODS)[number];

/**
 * Record the deposit receipt for a PENDING_DEPOSIT booking. Flips status to
 * PAID and stores cash-in metadata directly on the Booking row.
 * Note: we don't create a contract-Payment record here — Payment is strictly
 * contract-installment-bound. On conversion to a Sale, the deposit transfers
 * to Sale.downPaymentAmount.
 */
export class PayDepositDto {
  @IsOptional()
  @IsEnum(ALLOWED_METHODS, {
    message: 'depositMethod ต้องเป็นวิธีชำระเงินที่รองรับ (CASH/BANK_TRANSFER/QR_EWALLET/...)',
  })
  depositMethod?: DepositMethod;

  @IsOptional()
  @IsString()
  notes?: string;
}
