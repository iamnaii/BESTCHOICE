import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
  Max,
  Matches,
  IsBoolean,
} from 'class-validator';

export class ExpenseLineInput {
  /** CoA code prefixed 5x-xxxx (validated against chart_of_accounts in service) */
  @IsString()
  @Matches(/^5\d-\d{4}$/, { message: 'หมวดบัญชีต้องเป็นรูปแบบ 5x-xxxx' })
  category!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนต้องมากกว่า 0' })
  @Max(99999999.99, { message: 'จำนวนเกินขอบเขต' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'ราคาต่อหน่วยต้องมากกว่า 0' })
  @Max(99999999.99, { message: 'ราคาต่อหน่วยเกินขอบเขต' })
  unitPrice!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99, { message: 'ส่วนลดเกินขอบเขต' })
  @IsOptional()
  discount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  vatPercent?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  whtPercent?: number;

  /**
   * Per-line WHT form routing (Fix Report P2-4). When set, overrides the
   * document-level whtFormType for THIS line's WHT amount. Lets a single
   * EX doc mix individual (PND3 → 21-3102) and juristic (PND53 → 21-3103)
   * vendors without splitting into two documents.
   */
  @IsString()
  @IsIn(['PND3', 'PND53'])
  @IsOptional()
  whtFormType?: 'PND3' | 'PND53';

  /**
   * Phase A.5 — Per-line tax-disallowed override (ม.65 ตรี ป.รัษฎากร).
   * When true, THIS line is excluded from ภ.ง.ด.50/51 deductible totals
   * regardless of the doc-level flag. Only set when one document mixes
   * deductible + non-deductible categories. Default false.
   */
  @IsBoolean()
  @IsOptional()
  taxDisallowed?: boolean;
}
