import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsNumber,
  IsBoolean,
  Min,
  Matches,
  ValidateNested,
  ArrayMinSize,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

/**
 * C2 — Custom Income line (bonus, OT, per-diem allowances). V17 enforces
 * accountCode is on the system_config whitelist; V16 uses `isTaxable=false`
 * rows to exclude from the WHT base (ม.42 exemption).
 */
export class PayrollCustomIncomeInput {
  @IsString()
  @Matches(/^\d{2}-\d{4}$/, { message: 'หมวดบัญชีต้องเป็นรูปแบบ XX-XXXX' })
  accountCode!: string;

  @IsString()
  @MinLength(1, { message: 'ต้องระบุชื่อรายการรายได้' })
  name!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนต้องมากกว่า 0' })
  amount!: number;

  /** Default true. Set false for ม.42 tax-exempt items (per-diem, etc.). */
  @IsBoolean()
  @IsOptional()
  isTaxable?: boolean;
}

/**
 * C2 — Custom Deduction line (loan repayment, salary advance recovery,
 * uniform fee). Cr's the chosen account AND reduces the net cash leg.
 * No whitelist (employer-discretion); validator only enforces format.
 */
export class PayrollCustomDeductionInput {
  @IsString()
  @Matches(/^\d{2}-\d{4}$/, { message: 'หมวดบัญชีต้องเป็นรูปแบบ XX-XXXX' })
  accountCode!: string;

  @IsString()
  @MinLength(1, { message: 'ต้องระบุชื่อรายการหัก' })
  name!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนต้องมากกว่า 0' })
  amount!: number;
}

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
   * SSO per-person contribution (5% × min(salary, ceiling)).
   *
   * Cap is law-mandated (กฎกระทรวง) and changes ~every 3 years:
   *   - 2569+: ceiling 17,500 → max 875/person/month
   *   - 2572+: ceiling 20,000 → max 1,000/person/month
   *   - 2575+: ceiling 23,000 → max 1,150/person/month
   *
   * The applicable cap depends on the payroll's documentDate, not a static
   * value — so the cap is NOT enforced here in the DTO @Max. Instead,
   * `ExpenseDocumentsService.createPayroll` calls `SsoConfigService.validateContribution`
   * to validate against the period-effective row in `sso_config` table.
   * Source of truth: prisma migration 20260927000000_sso_config_table.
   *
   * `payroll.template.ts` reuses this value for the employer-side too
   * (accounting.md §SSO accounts) since law mandates identical 5% match — if
   * rates ever diverge, add a separate `ssoEmployer` field.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  ssoEmployee?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  whtAmount?: number;

  // C2 — Custom income + deduction (optional; legacy payroll with no extras
  // collapses to the base+sso+wht shape).
  @ValidateNested({ each: true })
  @Type(() => PayrollCustomIncomeInput)
  @IsOptional()
  customIncome?: PayrollCustomIncomeInput[];

  @ValidateNested({ each: true })
  @Type(() => PayrollCustomDeductionInput)
  @IsOptional()
  customDeduction?: PayrollCustomDeductionInput[];
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
