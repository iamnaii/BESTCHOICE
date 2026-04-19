import { IsString, MinLength, IsOptional, Length } from 'class-validator';

export class RegisterInviteDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8, { message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
  password: string;

  @IsString({ message: 'กรุณากรอกชื่อ' })
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  /// T7-C6: 6-digit OTP from SMS. Required when the invite was issued with
  /// a phone number. Skipped when admin created invite without phone (older
  /// flow — backwards compatible).
  @IsOptional()
  @IsString()
  @Length(6, 6, { message: 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก' })
  otp?: string;
}
