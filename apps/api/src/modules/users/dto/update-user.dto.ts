import { IsString, MinLength, IsOptional, IsIn, IsBoolean, Matches, MaxLength, IsDateString } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['SALES', 'BRANCH_MANAGER', 'ACCOUNTANT', 'OWNER'])
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
}
