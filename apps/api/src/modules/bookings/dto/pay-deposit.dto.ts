import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

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
 *
 * `depositAccountCode` is REQUIRED per `.claude/rules/accounting.md` Cash
 * Account Dimension policy — every cash-touching record carries one of the
 * 6 valid cash/bank CoA codes (11-1101..1103 cash, 11-1201..1203 bank).
 */
export class PayDepositDto {
  @IsEnum(ALLOWED_METHODS, {
    message: 'depositMethod ต้องเป็นวิธีชำระเงินที่รองรับ (CASH/BANK_TRANSFER/QR_EWALLET/...)',
  })
  depositMethod!: DepositMethod;

  @Matches(/^11-1[12]0[123]$/, {
    message: 'รหัสบัญชีเงินสดไม่ถูกต้อง (ต้องเป็น 11-1101..1103 หรือ 11-1201..1203)',
  })
  depositAccountCode!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
