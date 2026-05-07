import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';

export const ALLOWED_METHODS = ['CASH', 'TRANSFER', 'QR'] as const;
export type AllowedMethod = (typeof ALLOWED_METHODS)[number];

export class CreatePaymentMethodConfigDto {
  @IsString({ message: 'กรุณาระบุช่องทางรับชำระ' })
  @IsIn(ALLOWED_METHODS, { message: 'ช่องทางรับชำระไม่ถูกต้อง (CASH/TRANSFER/QR)' })
  method!: AllowedMethod;

  @IsString({ message: 'กรุณาระบุรหัสบัญชี' })
  @Matches(/^\d{2}-\d{4}$/, { message: 'รหัสบัญชีต้องอยู่ในรูปแบบ XX-XXXX' })
  accountCode!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
