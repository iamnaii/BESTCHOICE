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

/**
 * Petty Cash Reimbursement (C1) — small-cash float workflow.
 *
 * Differences vs CreateExpenseDocumentDto:
 *   - No doc-level `vendorName` / `vendorTaxId` — moved per-line via `supplierName`
 *   - `depositAccountCode` is the petty-cash float account (typically 11-1201)
 *     and is REQUIRED — V20 rejects other accounts unless config overrides
 *   - WHT intentionally omitted at line level (small-cash scope; vendors with
 *     WHT must use regular EXPENSE flow)
 *   - Per-line `supplierName` is REQUIRED (V20)
 */

class PettyCashLineInput {
  @IsString()
  @MinLength(2, { message: 'ชื่อผู้ขาย/ผู้รับเงินต้องมีอย่างน้อย 2 ตัวอักษร' })
  supplierName!: string;

  /** CoA code — must be type='ค่าใช้จ่าย' (53-xxxx range typically). */
  @IsString()
  @Matches(/^\d{2}-\d{4}$/, { message: 'หมวดบัญชีต้องเป็นรูปแบบ XX-XXXX' })
  category!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนต้องมากกว่า 0' })
  amount!: number;

  /** Per-line VAT% (typically 0 or 7 for petty cash). 0 if no tax invoice. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  vatPercent?: number;

  @IsString()
  @IsOptional()
  taxInvoiceNo?: string;
}

export class CreatePettyCashDto {
  @IsString()
  branchId!: string;

  @IsDateString({}, { message: 'วันที่ไม่ถูกต้อง' })
  documentDate!: string;

  @IsString()
  @IsOptional()
  description?: string;

  /**
   * Petty-cash float account — V20 enforces this is 11-1201 (or whatever the
   * `petty_cash_account` system_config row says). Required.
   */
  @IsString()
  depositAccountCode!: string;

  /** Custodian (employee taking responsibility for the float). Free text for now. */
  @IsString()
  @IsOptional()
  custodianName?: string;

  @ValidateNested({ each: true })
  @ArrayMinSize(1, { message: 'ต้องมีรายการอย่างน้อย 1 รายการ' })
  @Type(() => PettyCashLineInput)
  lines!: PettyCashLineInput[];

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
