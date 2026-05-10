import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsNumber,
  Min,
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

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
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
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'รูปแบบงวดต้องเป็น YYYY-MM' })
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
}
