import { IsString, IsNotEmpty, Length } from 'class-validator';

export class VerifyTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก' })
  code: string;
}

export class LoginTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 8, { message: 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก หรือ recovery code 8 หลัก' })
  code: string;
}

export class LoginTempTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ tempToken' })
  @Length(1, 512, { message: 'tempToken ยาวเกิน 512 ตัวอักษร' })
  tempToken: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ otp' })
  @Length(6, 8, { message: 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก หรือ recovery code 8 หลัก' })
  otp: string;
}
