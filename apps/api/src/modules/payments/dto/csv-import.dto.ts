import { IsString, IsOptional, IsIn } from 'class-validator';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

// Re-export for callers that already import from this DTO file.
export { CASH_ACCOUNT_CODES, type CashAccountCode } from '../../../constants/cash-account.constants';

export class ImportPaymentsCsvDto {
  @IsString()
  csv: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  /**
   * Default cash/bank account for rows that don't specify one in the CSV.
   * Per-row override: include `depositAccountCode` column in CSV.
   * If neither is provided, the importing user's `defaultCashAccountCode`
   * is used (fallback 11-1101).
   */
  @IsOptional()
  @IsString()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินไม่ถูกต้อง' })
  depositAccountCode?: string;
}
