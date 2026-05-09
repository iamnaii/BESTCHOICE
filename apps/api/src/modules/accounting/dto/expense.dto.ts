import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsDateString,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import {
  ExpenseAccountType,
  ExpenseStatus,
  PaymentMethod,
} from '@prisma/client';

export class CreateExpenseDto {
  @IsString()
  branchId: string;

  @IsEnum(ExpenseAccountType)
  accountType: ExpenseAccountType;

  @IsString()
  @IsNotEmpty()
  category: string; // Phase A.6: was ExpenseCategory enum; now stores CoA code OR legacy enum string

  @IsOptional()
  @IsString()
  accountCode?: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsBoolean()
  includeVat?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  withholdingTax?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  whtRate?: number; // อัตราภาษีหัก ณ ที่จ่าย เช่น 0.01, 0.02, 0.03, 0.05

  @IsOptional()
  @IsString()
  whtIncomeType?: string; // ประเภทเงินได้ เช่น '40(2)', '40(5)', '40(8)'

  @IsOptional()
  @IsIn(['PND3', 'PND53'], { message: 'whtFormType ต้องเป็น PND3 หรือ PND53' })
  whtFormType?: 'PND3' | 'PND53'; // PND3 (บุคคลธรรมดา → 21-3102) | PND53 (นิติบุคคล → 21-3103)

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
  @IsBoolean()
  taxDisallowed?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['NO_RECEIPT', 'PERSONAL_USE', 'PENALTY', 'OTHER'])
  disallowedReason?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsEnum(ExpenseAccountType)
  accountType?: ExpenseAccountType;

  @IsOptional()
  @IsString()
  category?: string; // Phase A.6: was ExpenseCategory enum; now stores CoA code OR legacy enum string

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
  @IsIn(['PND3', 'PND53'], { message: 'whtFormType ต้องเป็น PND3 หรือ PND53' })
  whtFormType?: 'PND3' | 'PND53';

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
  @IsBoolean()
  taxDisallowed?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['NO_RECEIPT', 'PERSONAL_USE', 'PENALTY', 'OTHER'])
  disallowedReason?: string;

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
