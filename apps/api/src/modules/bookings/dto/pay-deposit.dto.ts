import { IsIn, IsOptional, IsString } from 'class-validator';

export const BOOKING_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'QR_EWALLET'] as const;
export type DepositMethod = (typeof BOOKING_PAYMENT_METHODS)[number];

/** Receipt into SHOP. The server resolves and stores the actual branch/method account. */
export class PayDepositDto {
  @IsIn(BOOKING_PAYMENT_METHODS, { message: 'กรุณาเลือกวิธีรับเงินสด โอนธนาคาร หรือ QR / e-Wallet' })
  depositMethod!: DepositMethod;

  /** Optional compatibility assertion; a mismatched account is rejected, never stored. */
  @IsOptional()
  @IsString()
  depositAccountCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
