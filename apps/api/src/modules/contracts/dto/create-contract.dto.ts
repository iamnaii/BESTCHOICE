import { IsString, IsNumber, IsEnum, IsOptional } from 'class-validator';

export class CreateContractDto {
  @IsString()
  customerId: string;

  @IsString()
  productId: string;

  @IsString()
  branchId: string;

  @IsEnum(['STORE_DIRECT', 'CREDIT_CARD', 'STORE_WITH_INTEREST'])
  planType: string;

  @IsNumber()
  sellingPrice: number;

  @IsNumber()
  downPayment: number;

  @IsNumber()
  interestRate: number;

  @IsNumber()
  totalMonths: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
