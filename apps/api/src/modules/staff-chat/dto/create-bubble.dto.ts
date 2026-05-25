import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsNumber,
  IsObject,
  MaxLength,
} from 'class-validator';

export class CreateBubbleDto {
  @IsEnum(['TEXT', 'IMAGE', 'STICKER', 'CARD', 'LOCATION', 'VIDEO', 'JSON'], {
    message: 'type ไม่ถูกต้อง',
  })
  type!: 'TEXT' | 'IMAGE' | 'STICKER' | 'CARD' | 'LOCATION' | 'VIDEO' | 'JSON';

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'text ยาวเกิน 5000 ตัวอักษร' })
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  stickerPackageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  stickerId?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationTitle?: string;

  @IsOptional()
  @IsObject()
  json?: any;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];
}
