import { IsString, IsOptional, IsBoolean, IsIn, Matches, MaxLength } from 'class-validator';

export class CreateBankAccountDto {
  @IsString({ message: 'กรุณาระบุรหัสบัญชี' })
  @Matches(/^[0-9]{2}-[0-9]{4}$/, { message: 'รหัสบัญชีต้องอยู่ในรูปแบบ XX-XXXX' })
  accountCode!: string;

  @IsString({ message: 'กรุณาระบุชื่อบัญชี' })
  @MaxLength(200, { message: 'ชื่อบัญชียาวเกินไป' })
  accountName!: string;

  @IsString({ message: 'กรุณาระบุชื่อธนาคาร' })
  @MaxLength(100, { message: 'ชื่อธนาคารยาวเกินไป' })
  bankName!: string;

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
