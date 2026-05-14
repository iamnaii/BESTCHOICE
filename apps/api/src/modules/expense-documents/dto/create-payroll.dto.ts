import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsNumber,
  Min,
  Max,
  Matches,
  ValidateNested,
  ArrayMinSize,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

class PayrollLineInput {
  @IsString()
  @MinLength(2, { message: 'ชื่อพนักงานต้องมีอย่างน้อย 2 ตัวอักษร' })
  employeeName!: string;

  @IsString()
  @IsOptional()
  employeeTaxId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'เงินเดือนพื้นฐานต้องมากกว่า 0' })
  baseSalary!: number;

  /**
   * Fix #C11 — SSO per-person cap (Thai law).
   * SSO = 5% × min(salary, 15,000) → ceiling 750/person/month. payroll.template.ts
   * reuses this value for the employer-side too (accounting.md §SSO accounts), so
   * a single Max enforces both the employee deduction AND the employer match.
   * Lower values are fine (salary < 15k → SSO < 750).
   *
   * TODO (Round 2 / I2): SSO cap is mandated by Thai SSO law (last changed
   * 2019). If the cap moves, update this @Max + check `payroll.template.ts`
   * for any other hardcoded references. Consider moving to
   * SystemConfig['sso_monthly_cap'] when next refactoring payroll.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(750, { message: 'SSO ต่อคนไม่เกิน 750 บาท/เดือน (5% × 15000 ceiling)' })
  @IsOptional()
  ssoEmployee?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  whtAmount?: number;
}

export class CreatePayrollDto {
  @IsString()
  branchId!: string;

  @IsDateString({}, { message: 'วันที่จ่ายไม่ถูกต้อง' })
  documentDate!: string;

  @IsString()
  @Matches(/^(20\d{2})-(0[1-9]|1[0-2])$/, {
    message: 'รูปแบบงวดต้องเป็น YYYY-MM (ค.ศ. 2000-2099) — ห้ามใช้ พ.ศ.',
  })
  payrollPeriod!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินไม่ถูกต้อง' })
  depositAccountCode!: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ValidateNested({ each: true })
  @ArrayMinSize(1, { message: 'ต้องมีพนักงานอย่างน้อย 1 คน' })
  @Type(() => PayrollLineInput)
  lines!: PayrollLineInput[];

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  fromTemplateId?: string;
}
