import { IsString, IsIn, Length, IsOptional } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @IsIn(['SMS', 'LINE'], { message: 'ช่องทางต้องเป็น SMS หรือ LINE' })
  channel: string;
}

export class VerifyOtpDto {
  @IsString()
  @Length(6, 6, { message: 'รหัส OTP ต้อง 6 หลัก' })
  otp: string;
}

export class UploadIdCardDto {
  @IsString()
  imageBase64: string;

  @IsString()
  @IsOptional()
  deviceInfo?: string;
}
