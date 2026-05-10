import { IsString, IsOptional, IsIn, IsInt, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class ListExpenseDocumentsQueryDto {
  @IsString()
  @IsOptional()
  @IsIn(['all', 'draft', 'unpaid', 'recorded', 'paid'])
  tab?: string;

  @IsString()
  @IsOptional()
  @IsIn(['EXPENSE', 'CREDIT_NOTE', 'PAYROLL', 'VENDOR_SETTLEMENT'])
  type?: string;

  @IsString()
  @IsOptional()
  @IsIn(['DRAFT', 'ACCRUAL', 'POSTED', 'VOIDED'])
  status?: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
