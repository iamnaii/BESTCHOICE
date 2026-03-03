import { IsString, IsOptional, IsNumber, IsEnum, IsIn, IsArray } from 'class-validator';
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

  // Payment method (all sale types)
  @IsIn(['CASH', 'BANK_TRANSFER'])
  @IsOptional()
  paymentMethod?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  amountReceived?: number;

  // Down payment (for INSTALLMENT and EXTERNAL_FINANCE)
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  downPayment?: number;

  // Contract number (for INSTALLMENT and EXTERNAL_FINANCE)
  @IsString()
  @IsOptional()
  contractNumber?: string;

  // Installment fields
  @IsIn(['STORE_DIRECT', 'CREDIT_CARD', 'STORE_WITH_INTEREST'])
  @IsOptional()
  planType?: string;

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

  // Bundle / freebie product IDs
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  bundleProductIds?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}
