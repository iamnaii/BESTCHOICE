import { IsOptional, IsString, IsEnum, IsNumberString } from 'class-validator';
import { ExpenseCategory } from '@prisma/client';

export class QueryExpenseDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsEnum(ExpenseCategory)
  @IsOptional()
  category?: ExpenseCategory;

  @IsNumberString()
  @IsOptional()
  month?: string;

  @IsNumberString()
  @IsOptional()
  year?: string;

  @IsNumberString()
  @IsOptional()
  page?: string;

  @IsNumberString()
  @IsOptional()
  limit?: string;
}
