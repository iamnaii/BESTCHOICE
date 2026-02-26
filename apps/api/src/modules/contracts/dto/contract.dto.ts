import { IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';

export class CreateContractDto {
  @IsString()
  customerId: string;

  @IsString()
  productId: string;

  @IsString()
  branchId: string;

  @IsString()
  planType: string; // STORE_DIRECT, CREDIT_CARD, STORE_WITH_INTEREST

  @IsNumber()
  sellingPrice: number;

  @IsNumber()
  downPayment: number;

  @IsNumber()
  totalMonths: number;

  @IsNumber()
  @IsOptional()
  interestRate?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class EarlyPayoffDto {
  @IsString()
  paymentMethod: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
