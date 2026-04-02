import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsDateString,
  IsBoolean,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import {
  ExpenseAccountType,
  ExpenseCategory,
  ExpenseStatus,
  PaymentMethod,
} from '@prisma/client';

export class CreateExpenseDto {
  @IsString()
  branchId: string;

  @IsEnum(ExpenseAccountType)
  accountType: ExpenseAccountType;

  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @IsOptional()
  @IsString()
  accountCode?: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  withholdingTax?: number;

  @IsDateString()
  expenseDate: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  vendorName?: string;

  @IsOptional()
  @IsString()
  vendorTaxId?: string;

  @IsOptional()
  @IsString()
  receiptImageUrl?: string;

  @IsOptional()
  @IsString()
  taxInvoiceNo?: string;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  recurringDay?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsEnum(ExpenseAccountType)
  accountType?: ExpenseAccountType;

  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @IsOptional()
  @IsString()
  accountCode?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  withholdingTax?: number;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  vendorName?: string;

  @IsOptional()
  @IsString()
  vendorTaxId?: string;

  @IsOptional()
  @IsString()
  receiptImageUrl?: string;

  @IsOptional()
  @IsString()
  taxInvoiceNo?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ApproveExpenseDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class RejectExpenseDto {
  @IsString()
  reason: string;
}
