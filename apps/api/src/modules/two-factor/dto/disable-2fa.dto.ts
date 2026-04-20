import { IsString, IsNotEmpty, Length } from 'class-validator';

export class Disable2faDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรหัสยืนยัน' })
  @Length(6, 8, { message: 'รหัสต้องเป็น OTP 6 หลัก หรือ backup code 8 หลัก' })
  currentToken: string;
}
