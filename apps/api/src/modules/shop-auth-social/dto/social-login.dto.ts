import { IsString, IsOptional, IsEnum } from 'class-validator';

export class LineLoginCallbackDto {
  @IsString()
  code!: string; // OAuth code from LINE
}

export class FacebookLoginCallbackDto {
  @IsString()
  accessToken!: string; // FB SDK access token
}

export class BindPhoneDto {
  @IsString()
  phone!: string;

  @IsEnum(['LINE', 'FACEBOOK'])
  provider!: 'LINE' | 'FACEBOOK';

  @IsString()
  providerUserId!: string;
}
