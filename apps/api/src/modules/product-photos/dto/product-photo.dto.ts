import { IsString, Matches, MaxLength } from 'class-validator';

const BASE64_PATTERN = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;

export class UploadProductPhotoDto {
  @IsString()
  @Matches(/^(front|back|left|right|top|bottom)$/, { message: 'angle ต้องเป็น front, back, left, right, top, bottom' })
  angle: string;

  @IsString()
  @MaxLength(15_000_000, { message: 'ไฟล์รูปภาพต้องไม่เกิน 10MB' })
  @Matches(BASE64_PATTERN, { message: 'รูปภาพต้องเป็น base64 data URL (JPEG, PNG, GIF, WEBP)' })
  photo: string;
}
