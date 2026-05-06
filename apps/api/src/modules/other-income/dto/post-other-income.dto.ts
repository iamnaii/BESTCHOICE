import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class OverrideJournalLineDto {
  @IsString()
  accountCode!: string;

  @IsNumber()
  debit!: number;

  @IsNumber()
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
