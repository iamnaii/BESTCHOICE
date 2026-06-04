import {
  IsString,
  IsOptional,
  IsDateString,
  ValidateNested,
  IsArray,
  ArrayMinSize,
  IsIn,
  IsNumberString,
  IsBoolean,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseLineInput } from './expense-line-input.dto';
import { ExpenseAdjustmentInput } from './expense-adjustment-input.dto';

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

  /**
   * Party-master link (Phase 3 P3). Durable FK to the Supplier the UI picker
   * provisioned for `vendorName`. Optional — no required-FK guard (several
   * subtypes set vendorName programmatically with no supplier).
   */
  @IsUUID('4')
  @IsOptional()
  vendorSupplierId?: string;

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

  /**
   * Phase A.5 — Tax-disallowed doc-level flag (ม.65 ตรี ป.รัษฎากร).
   * When true, ALL lines in this document are excluded from ภ.ง.ด.50/51
   * deductible totals. Disallowed expenses are still booked normally — the
   * flag only affects year-end corporate income-tax filing, never the JE.
   * Default false (deductible) for backwards compatibility.
   */
  @IsBoolean()
  @IsOptional()
  taxDisallowed?: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องมีรายการบัญชีอย่างน้อย 1 บรรทัด' })
  @ValidateNested({ each: true })
  @Type(() => ExpenseLineInput)
  lines!: ExpenseLineInput[];

  /**
   * Optional `amount_paid ≠ amount_expected` adjustment rows (Fix Report P0-4).
   * Service-level V12 enforces Σ signed(adjustments) = amountPaid − netExpected.
   */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseAdjustmentInput)
  @IsOptional()
  adjustments?: ExpenseAdjustmentInput[];

  /**
   * Optional explicit "what we actually paid" amount. When set, must reconcile
   * to `totalAmount − wht` ± Σ signed(adjustments) (V12). When omitted, the
   * cash leg defaults to `totalAmount − wht` (legacy zero-adjustment behaviour).
   */
  @IsNumberString({ no_symbols: true })
  @IsOptional()
  amountPaid?: string;
}
