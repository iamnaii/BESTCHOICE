import { IsString, IsOptional, Matches, MaxLength } from 'class-validator';

const BASE64_PATTERN = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;

export class UploadProductPhotoDto {
  @IsString()
  @Matches(/^(front|back|left|right|top|bottom|imeiScreen|regulatory|batteryScreen|partsHistoryScreen)$/, { message: 'ช่องรูปไม่ถูกต้อง' })
  angle: string;

  @IsString()
  @MaxLength(15_000_000, { message: 'ไฟล์รูปภาพต้องไม่เกิน 10MB' })
  @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  photo: string;
}

export class CreateAnglePhotosDto {
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  front?: string;
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  back?: string;
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  left?: string;
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  right?: string;
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  top?: string;
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  bottom?: string;
}

export class EvidencePhotosDto {
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  imeiScreen?: string;
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  regulatory?: string;
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  batteryScreen?: string;
  @IsOptional() @IsString() @MaxLength(7_000_000) @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  partsHistoryScreen?: string;
}
