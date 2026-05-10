import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

class ExpenseDetailInput {
  @IsString()
  category!: string;
}

export class CreateExpenseDocumentDto {
  // PR-1 supports EXPENSE only. CN/PR/SE shorthand endpoints come later.
  @IsIn(['EXPENSE'], { message: 'ใน PR-1 รองรับเฉพาะ EXPENSE — CN/PR/SE ทำใน PR-2..4' })
  documentType!: 'EXPENSE';

  @IsString()
  branchId!: string;

  @IsDateString({}, { message: 'วันที่ใบกำกับไม่ถูกต้อง' })
  documentDate!: string;

  @IsString()
  @IsOptional()
  vendorName?: string;

  @IsString()
  @IsOptional()
  vendorTaxId?: string;

  @IsString()
  @IsOptional()
  taxInvoiceNo?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  subtotal!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  vatAmount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  withholdingTax?: number;

  @IsString()
  @IsOptional()
  @IsIn(['PND3', 'PND53'])
  whtFormType?: string;

  // Payment dimension (for Same-day flow). If absent → ACCRUAL.
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินไม่ถูกต้อง' })
  depositAccountCode?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  receiptImageUrl?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @ValidateNested()
  @Type(() => ExpenseDetailInput)
  detail!: ExpenseDetailInput;
}
