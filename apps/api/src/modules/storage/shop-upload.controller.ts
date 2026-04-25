import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
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
  // P2 Task 4 — voice memo evidence captured in ContactLogDialog.
  VOICE_MEMO = 'VOICE_MEMO',
}

/**
 * MIME allow-list per kind. When set, presign rejects unknown contentTypes.
 * Kinds NOT in this map fall back to the legacy `application/pdf | image/png |
 * image/jpeg` heuristic — preserved to avoid regressing existing flows.
 */
const ALLOWED_MIME_BY_KIND: Partial<Record<UploadKind, readonly string[]>> = {
  [UploadKind.VOICE_MEMO]: [
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
    'audio/mpeg',
  ],
};

function pickExtension(kind: UploadKind, contentType: string): string {
  if (kind === UploadKind.VOICE_MEMO) {
    if (contentType.includes('mp4')) return 'm4a';
    if (contentType.includes('ogg')) return 'ogg';
    if (contentType.includes('mpeg')) return 'mp3';
    return 'webm';
  }
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'image/png') return 'png';
  return 'jpg';
}

function pickBasePath(kind: UploadKind): string {
  if (kind === UploadKind.VOICE_MEMO) return 'voice-memos';
  if (kind.startsWith('LETTER_')) return 'letters';
  if (kind.startsWith('MDM_')) return 'mdm-assets';
  return 'shop';
}

export class PresignedUploadDto {
  @IsEnum(UploadKind, { message: 'ประเภทไฟล์ไม่ถูกต้อง' })
  kind!: UploadKind;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ contentType' })
  contentType!: string;
}

// Per-kind MIME whitelists. Client's `contentType` is untrusted — server must
// verify against the allowed set for the requested upload kind. A mismatch is
// a 400 BadRequest (Thai message) rather than a signed URL handed to the client.
const ALLOWED_MIME_BY_KIND: Record<UploadKind, readonly string[]> = {
  [UploadKind.TRADE_IN_PHOTO]: ['image/jpeg', 'image/png', 'image/webp'],
  [UploadKind.BUYBACK_PHOTO]: ['image/jpeg', 'image/png', 'image/webp'],
  [UploadKind.BANK_SLIP]: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  [UploadKind.REVIEW_PHOTO]: ['image/jpeg', 'image/png', 'image/webp'],
  [UploadKind.LETTER_PDF]: ['application/pdf'],
  [UploadKind.LETTER_EVIDENCE]: ['image/jpeg', 'image/png', 'application/pdf'],
  [UploadKind.LETTER_SIGNATURE]: ['image/png', 'image/jpeg'],
  [UploadKind.LETTER_LETTERHEAD]: ['image/png', 'image/jpeg'],
};

@Controller('shop/upload')
@UseGuards(JwtAuthGuard)
export class ShopUploadController {
  constructor(private storage: StorageService) {}

  @Post('signed-url')
  async presign(@Body() dto: PresignedUploadDto) {
    const allowed = ALLOWED_MIME_BY_KIND[dto.kind];
    if (allowed) {
      // contentType may include codecs (e.g. `audio/webm;codecs=opus`) — match
      // on the leading mediatype.
      const baseType = dto.contentType.split(';')[0].trim();
      if (!allowed.includes(baseType)) {
        throw new BadRequestException(
          `contentType "${dto.contentType}" ไม่รองรับสำหรับประเภท ${dto.kind}`,
        );
      }
    }

    const ext = pickExtension(dto.kind, dto.contentType);
    const date = new Date().toISOString().slice(0, 10);
    const basePath = pickBasePath(dto.kind);
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
