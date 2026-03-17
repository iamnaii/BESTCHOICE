import { IsString, IsIn, Length, IsOptional } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @IsIn(['SMS', 'LINE'])
  channel: string;
}

export class VerifyOtpDto {
  @IsString()
  @Length(6, 6)
  otp: string;
}

export class UploadIdCardDto {
  @IsString()
  imageBase64: string;

  @IsString()
  @IsOptional()
  deviceInfo?: string;
}
