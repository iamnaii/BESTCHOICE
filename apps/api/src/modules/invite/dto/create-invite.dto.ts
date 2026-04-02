import { IsEmail, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateInviteDto {
  @IsEmail({}, { message: 'กรุณากรอกอีเมลที่ถูกต้อง' })
  email: string;

  @IsEnum(UserRole, { message: 'ตำแหน่งไม่ถูกต้อง' })
  role: UserRole;

  @IsOptional()
  @IsUUID('4', { message: 'รหัสสาขาไม่ถูกต้อง' })
  branchId?: string;
}
