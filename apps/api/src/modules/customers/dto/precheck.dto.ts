import { IsString, IsOptional, IsArray, Matches } from 'class-validator';
import type { CustomerTier } from './tier.dto';

export class CustomerPreCheckDto {
  @IsString()
  @Matches(/^\d{13}$/, { message: 'เลขบัตรประชาชนต้องมี 13 หลัก' })
  nationalId!: string;

  @IsString()
  @Matches(/^0\d{8,9}$/, { message: 'เบอร์โทรไม่ถูกต้อง' })
  phone!: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statementFiles?: string[];
}

export type PreCheckDecision = 'PASS' | 'FAIL' | 'REVIEW';

export interface CustomerPreCheckResponse {
  customerId: string;
  isNewCustomer: boolean;
  tier: CustomerTier;
  decision: PreCheckDecision;
  reasons: { code: string; message: string }[];
  aiScore?: number;
  creditCheckId?: string;
}
