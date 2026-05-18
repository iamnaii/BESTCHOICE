import { IsString, IsOptional, IsBoolean, IsIn, MaxLength } from 'class-validator';

export class UpdateBankAccountDto {
  @IsString()
  @IsOptional()
  @MaxLength(200, { message: 'ชื่อบัญชียาวเกินไป' })
  accountName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100, { message: 'ชื่อธนาคารยาวเกินไป' })
  bankName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50, { message: 'เลขบัญชียาวเกินไป' })
  accountNumber?: string;

  @IsString()
  @IsOptional()
  @IsIn(['SAVINGS', 'CURRENT', 'FIXED', 'CASH'], {
    message: 'ประเภทบัญชีไม่ถูกต้อง',
  })
  accountType?: 'SAVINGS' | 'CURRENT' | 'FIXED' | 'CASH';

  @IsString()
  @IsOptional()
  @MaxLength(10)
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'หมายเหตุยาวเกินไป' })
  notes?: string;
}
