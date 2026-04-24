import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { randomUUID } from 'crypto';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

export enum UploadKind {
  TRADE_IN_PHOTO = 'TRADE_IN_PHOTO',
  BUYBACK_PHOTO = 'BUYBACK_PHOTO',
  BANK_SLIP = 'BANK_SLIP',
  REVIEW_PHOTO = 'REVIEW_PHOTO',
  LETTER_PDF = 'LETTER_PDF',
  LETTER_EVIDENCE = 'LETTER_EVIDENCE',
  LETTER_SIGNATURE = 'LETTER_SIGNATURE',
  LETTER_LETTERHEAD = 'LETTER_LETTERHEAD',
  MDM_WALLPAPER = 'MDM_WALLPAPER',
}

export class PresignedUploadDto {
  @IsEnum(UploadKind, { message: 'ประเภทไฟล์ไม่ถูกต้อง' })
  kind!: UploadKind;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ contentType' })
  contentType!: string;
}

@Controller('shop/upload')
@UseGuards(JwtAuthGuard)
export class ShopUploadController {
  constructor(private storage: StorageService) {}

  @Post('signed-url')
  async presign(@Body() dto: PresignedUploadDto) {
    const ext =
      dto.contentType === 'application/pdf'
        ? 'pdf'
        : dto.contentType === 'image/png'
          ? 'png'
          : 'jpg';
    const date = new Date().toISOString().slice(0, 10);
    const isLetterKind = dto.kind.startsWith('LETTER_');
    const isMdmKind = dto.kind.startsWith('MDM_');
    const basePath = isLetterKind ? 'letters' : isMdmKind ? 'mdm-assets' : 'shop';
    const key = `${basePath}/${dto.kind.toLowerCase()}/${date}/${randomUUID()}.${ext}`;
    const signed = await this.storage.getSignedUploadUrl(key, dto.contentType);
    return {
      uploadUrl: signed.url,
      method: signed.method,
      key,
      publicUrl: this.storage.getPublicUrl(key),
    };
  }
}
