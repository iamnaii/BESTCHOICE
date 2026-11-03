import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Override JV line. Amounts are limited to 2 decimals (re-review m2, 2026-11-01): `journal_lines.debit/credit` are
 * numeric(12,2) — a 3rd decimal is rounded per line by Postgres, so a set of lines that balances exactly on the raw
 * values (V1) can be stored unbalanced (50.005 + 50.005 / 100.01 → 100.02 / 100.01).
 */
export class OverrideJournalLineDto {
  @IsString()
  accountCode!: string;

  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'ยอดเดบิตต้องเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่ง (สตางค์)' },
  )
  debit!: number;

  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'ยอดเครดิตต้องเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่ง (สตางค์)' },
  )
  credit!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class PostOtherIncomeDto {
  @IsOptional()
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverrideJournalLineDto)
  overrideLines?: OverrideJournalLineDto[];
}
