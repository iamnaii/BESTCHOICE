import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsNumber,
  IsNumberString,
  IsUUID,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';
import { ExpenseAdjustmentInput } from './expense-adjustment-input.dto';

class SettlementLineInput {
  @IsUUID('4', { message: 'รหัสเอกสารที่ต้องการเคลียร์ไม่ถูกต้อง' })
  clearedDocumentId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนเงินที่จ่ายต้องมากกว่า 0' })
  amountSettled!: number;
}

export class CreateSettlementDto {
  @IsString()
  branchId!: string;

  @IsDateString({}, { message: 'วันที่จ่ายไม่ถูกต้อง' })
  documentDate!: string;

  @IsString()
  @IsOptional()
  vendorName?: string;

  /**
   * Party-master link (Phase 3 P3). Durable FK to the Supplier behind
   * `vendorName`. Optional.
   */
  @IsString()
  @IsOptional()
  vendorSupplierId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินไม่ถูกต้อง' })
  depositAccountCode!: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  withholdingTax?: number;

  @IsString()
  @IsOptional()
  @IsIn(['PND3', 'PND53'], { message: 'แบบฟอร์ม WHT ต้องเป็น PND3 หรือ PND53' })
  whtFormType?: string;

  @ValidateNested({ each: true })
  @ArrayMinSize(1, { message: 'ต้องมีรายการอย่างน้อย 1 รายการ' })
  @Type(() => SettlementLineInput)
  lines!: SettlementLineInput[];

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  fromTemplateId?: string;

  /**
   * Multi-line Adjustment (B2 / Dev Action #2). When the actual amount paid
   * to the vendor differs from `sumSettled − wht` (e.g. supplier discount,
   * bank fee, rounding), adjustments balance the gap. Signed-sum rule (V12):
   *   Σ signed(adjustments) === amountPaid − (sumSettled − wht)
   * where CR contributes +amount and DR contributes −amount.
   * Allow-list of accountCodes is enforced server-side (V13).
   */
  @ValidateNested({ each: true })
  @Type(() => ExpenseAdjustmentInput)
  @IsOptional()
  adjustments?: ExpenseAdjustmentInput[];

  /**
   * Actual cash leg paid to vendor. When set, must reconcile via V12 against
   * `sumSettled − wht` ± Σ signed(adjustments). Omitted ⇒ defaults to
   * `sumSettled − wht` (legacy zero-adjustment behaviour).
   */
  @IsNumberString({ no_symbols: true })
  @IsOptional()
  amountPaid?: string;
}
