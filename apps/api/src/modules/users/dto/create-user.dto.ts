import { IsEmail, IsString, MinLength, IsOptional, IsIn, Matches, MaxLength, IsDateString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EmployeeProfileInputDto } from './employee-profile-input.dto';

export class CreateUserDto {
  @IsEmail()
  email: string;

  // 8 ตัวอักษร — ให้ตรงกับ RegisterInviteDto (เส้นทางที่พนักงานตั้งรหัสเอง)
  // เดิม 6 ที่นี่/8 ที่นั่น = คนละมาตรฐานบนบัญชีชนิดเดียวกัน
  @IsString()
  @MinLength(8, { message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
  password: string;

  @IsString()
  name: string;

  @IsString()
  @IsIn(['SALES', 'BRANCH_MANAGER', 'ACCOUNTANT', 'FINANCE_MANAGER', 'OWNER'])
  role: string;

  @IsOptional()
  @IsString()
  branchId?: string;

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

  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeProfileInputDto)
  employee?: EmployeeProfileInputDto;
}
