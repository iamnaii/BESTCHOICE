import { IsString, IsNumber, IsOptional, IsInt, Min, Max, Matches } from 'class-validator';

export class CreateContractDto {
  @IsString()
  customerId: string;

  @IsString()
  productId: string;

  @IsString()
  branchId: string;

  @IsString()
  @Matches(/^(STORE_DIRECT|CREDIT_CARD|STORE_WITH_INTEREST)$/, { message: 'planType ต้องเป็น STORE_DIRECT, CREDIT_CARD หรือ STORE_WITH_INTEREST' })
  planType: string;

  @IsNumber()
  @Min(1)
  sellingPrice: number;

  @IsNumber()
  @Min(0)
  downPayment: number;

  @IsNumber()
  @IsInt()
  @Min(1)
  totalMonths: number;

  @IsNumber()
  @IsOptional()
  interestRate?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  // วันที่ครบกำหนดชำระ ตามวันเงินเดือนออก (1-28 หรือ 31=สิ้นเดือน)
  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  paymentDueDay?: number;
}

export class UpdateContractDto {
  @IsNumber()
  @Min(1)
  @IsOptional()
  sellingPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  downPayment?: number;

  @IsNumber()
  @IsInt()
  @Min(1)
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
  @Max(31)
  @IsOptional()
  paymentDueDay?: number;
}

export class EarlyPayoffDto {
  @IsString()
  @Matches(/^(CASH|BANK_TRANSFER|QR_EWALLET)$/, { message: 'paymentMethod ต้องเป็น CASH, BANK_TRANSFER หรือ QR_EWALLET' })
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
