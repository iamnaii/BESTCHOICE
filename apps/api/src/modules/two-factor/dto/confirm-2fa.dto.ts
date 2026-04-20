import { IsString, IsNotEmpty, Length } from 'class-validator';

export class Confirm2faDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรหัส OTP' })
  @Length(6, 6, { message: 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก' })
  token: string;
}
