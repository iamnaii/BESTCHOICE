import { IsString, IsNumber, IsOptional, IsInt, Min, Max } from 'class-validator';

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

  // วันที่ครบกำหนดชำระ ตามวันเงินเดือนออก (1-28)
  @IsInt()
  @Min(1)
  @Max(28)
  @IsOptional()
  paymentDueDay?: number;
}

export class UpdateContractDto {
  @IsNumber()
  @IsOptional()
  sellingPrice?: number;

  @IsNumber()
  @IsOptional()
  downPayment?: number;

  @IsNumber()
  @IsOptional()
  totalMonths?: number;

  @IsNumber()
  @IsOptional()
  interestRate?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsInt()
  @Min(1)
  @Max(28)
  @IsOptional()
  paymentDueDay?: number;
}

export class EarlyPayoffDto {
  @IsString()
  paymentMethod: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ReviewContractDto {
  @IsString()
  @IsOptional()
  reviewNotes?: string;
}

export class RejectContractDto {
  @IsString()
  reviewNotes: string; // เหตุผลปฏิเสธ (บังคับ)
}
