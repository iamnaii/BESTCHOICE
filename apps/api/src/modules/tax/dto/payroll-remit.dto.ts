import { IsDateString, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PAYROLL_CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

/**
 * นำส่ง ปกส. (สปส.1-10) / ภ.ง.ด.1 — payroll round 2 (2026-08-06).
 * Per-book remittance (design D1): each scope clears its own payables from its
 * own bank. Scope↔deposit consistency re-checked in PayrollRemittanceTemplate.
 */
export class PayrollRemitDto {
  @IsString()
  @IsIn(['SHOP', 'FINANCE'], { message: 'scope ต้องเป็น SHOP หรือ FINANCE' })
  scope!: 'SHOP' | 'FINANCE';

  @IsString()
  @Matches(/^(20\d{2})-(0[1-9]|1[0-2])$/, {
    message: 'รูปแบบงวดต้องเป็น YYYY-MM (ค.ศ.) — ห้ามใช้ พ.ศ.',
  })
  period!: string;

  @IsString()
  @IsIn([...PAYROLL_CASH_ACCOUNT_CODES], { message: 'บัญชีจ่ายเงินไม่ถูกต้อง' })
  depositAccountCode!: string;

  @IsDateString({}, { message: 'วันที่จ่ายไม่ถูกต้อง' })
  @IsOptional()
  payDate?: string;
}
