import { IsString, IsOptional, IsNumber, IsEnum, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSaleDto {
  @IsEnum(['CASH', 'INSTALLMENT', 'EXTERNAL_FINANCE'])
  saleType: string;

  @IsString()
  customerId: string;

  @IsString()
  productId: string;

  @IsString()
  branchId: string;

  @IsNumber()
  @Type(() => Number)
  sellingPrice: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  discount?: number;

  // Payment (for CASH and EXTERNAL_FINANCE)
  @IsIn(['CASH', 'BANK_TRANSFER', 'QR_EWALLET'])
  @IsOptional()
  paymentMethod?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  amountReceived?: number;

  // Installment fields
  @IsIn(['STORE_DIRECT', 'CREDIT_CARD', 'STORE_WITH_INTEREST'])
  @IsOptional()
  planType?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  downPayment?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  totalMonths?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  interestRate?: number;

  // External finance fields
  @IsString()
  @IsOptional()
  financeCompany?: string;

  @IsString()
  @IsOptional()
  financeRefNumber?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  financeAmount?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
