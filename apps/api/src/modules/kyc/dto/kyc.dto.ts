import { IsString, Length, IsOptional } from 'class-validator';

// SendOtpDto: historically accepted `channel: 'SMS' | 'LINE'`. LINE was removed
// on 2026-04-23 because OTP-via-LINE breaks out-of-band phone-ownership
// verification (OTP going to the same LINE session that's already identified
// doesn't prove the user controls the phone number). SMS is the only channel
// now — the DTO is empty and kept only as a stable shape for Swagger / future
// fields. ValidationPipe `whitelist: true` silently strips any stale `channel`
// field from old frontends, so this change is backward-compatible.
export class SendOtpDto {}

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
