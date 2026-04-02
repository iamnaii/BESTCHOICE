import { IsString, MinLength, IsOptional } from 'class-validator';

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
}
