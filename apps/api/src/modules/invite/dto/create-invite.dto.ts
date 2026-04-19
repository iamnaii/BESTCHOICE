import { IsEmail, IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateInviteDto {
  @IsEmail({}, { message: 'กรุณากรอกอีเมลที่ถูกต้อง' })
  email: string;

  @IsEnum(UserRole, { message: 'ตำแหน่งไม่ถูกต้อง' })
  role: UserRole;

  @IsOptional()
  @IsUUID('4', { message: 'รหัสสาขาไม่ถูกต้อง' })
  branchId?: string;

  /// T7-C6: phone เพื่อส่ง OTP ผ่าน SMS คนละ channel กับ email — ทำให้
  /// email compromise ไม่พอจะเข้ายึด invite ได้
  @IsOptional()
  @Matches(/^0[0-9]{9}$/, { message: 'เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0' })
  phone?: string;
}
