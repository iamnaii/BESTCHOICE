import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/** Calculation input only: quoting never claims credit, receives money or reserves stock. */
export class ContractQuoteDto {
  @IsString() customerId!: string;
  @IsString() productId!: string;
  @IsString() branchId!: string;
  @IsNumber() @Min(1, { message: 'ราคาขายต้องมากกว่า 0' }) @Max(9999999) sellingPrice!: number;
  @IsNumber() @Min(0, { message: 'เงินดาวน์ต้องไม่ติดลบ' }) @Max(9999999) downPayment!: number;
  @IsInt() @Min(1) @Max(120) totalMonths!: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) paymentDueDay?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) interestRate?: number;
  @IsOptional() @IsUUID() tradeInCreditId?: string;
}
