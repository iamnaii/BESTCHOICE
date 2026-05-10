import {
  IsString,
  IsOptional,
  IsDateString,
  ValidateNested,
  IsArray,
  ArrayMinSize,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseLineInput } from './expense-line-input.dto';

const PRICE_TYPES = ['EXCLUSIVE', 'INCLUSIVE'] as const;
const CASH_ACCOUNT_CODES = ['11-1101', '11-1102', '11-1103', '11-1201', '11-1202', '11-1203'] as const;

export class CreateExpenseDocumentDto {
  @IsIn(['EXPENSE'])
  documentType!: 'EXPENSE';

  @IsString()
  branchId!: string;

  @IsDateString()
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

  @IsString()
  @IsIn(PRICE_TYPES as never)
  @IsOptional()
  priceType?: 'EXCLUSIVE' | 'INCLUSIVE';

  /** Form-type for WHT routing (PND.3 → 21-3102, PND.53 → 21-3103) */
  @IsString()
  @IsIn(['PND3', 'PND53'])
  @IsOptional()
  whtFormType?: 'PND3' | 'PND53';

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsIn([...CASH_ACCOUNT_CODES])
  @IsOptional()
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

  @IsString()
  @IsOptional()
  fromTemplateId?: string;

  @IsString()
  @IsOptional()
  approvedById?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องมีรายการบัญชีอย่างน้อย 1 บรรทัด' })
  @ValidateNested({ each: true })
  @Type(() => ExpenseLineInput)
  lines!: ExpenseLineInput[];
}
