import { IsString, MinLength, IsOptional, IsIn, IsBoolean, Matches, MaxLength, IsDateString } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['SALES', 'BRANCH_MANAGER', 'ACCOUNTANT', 'FINANCE_MANAGER', 'OWNER'])
  role?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  @Matches(/^0[0-9]{9}$/, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องเป็นตัวเลข 10 หลัก)' })
  phone?: string;

  @IsOptional()
  @IsString()
  lineId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  @Matches(/^data:image\/(png|jpeg|webp);base64,/, { message: 'รูปภาพไม่ถูกต้อง' })
  avatarUrl?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{13}$/, { message: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก' })
  nationalId?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  /** บัญชีรับเงินเริ่มต้นของ user เช่น 11-1101 / 11-1201 */
  @IsOptional()
  @IsString()
  @Matches(/^11-(110[1-3]|120[1-3])$/, { message: 'defaultCashAccountCode ต้องเป็น 11-1101..03 หรือ 11-1201..03' })
  defaultCashAccountCode?: string;
}
