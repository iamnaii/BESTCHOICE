import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  Max,
  MinLength,
  Matches,
} from 'class-validator';

export class ExpenseLineInput {
  /** CoA code prefixed 5x-xxxx (validated against chart_of_accounts in service) */
  @IsString()
  @Matches(/^5\d-\d{4}$/, { message: 'หมวดบัญชีต้องเป็นรูปแบบ 5x-xxxx' })
  category!: string;

  @IsString()
  @IsOptional()
  @MinLength(0)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนต้องมากกว่า 0' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'ราคาต่อหน่วยต้องมากกว่า 0' })
  unitPrice!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
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
}
