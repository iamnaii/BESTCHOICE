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

/**
 * Z7: codec allow-list per kind. When set, the codec parameter inside a
 * `contentType` string (e.g. `audio/webm;codecs=opus`) is matched against
 * this list and unknown codecs are rejected. Stops crafted `;codecs=evil`
 * params from sneaking past the base-MIME check.
 */
const ALLOWED_CODECS_BY_KIND: Partial<Record<UploadKind, readonly string[]>> = {
  // Browsers' MediaRecorder produces these on Chrome/Safari/Firefox; AAC/MP3
  // covered for clients that re-encode before upload.
  [UploadKind.VOICE_MEMO]: ['opus', 'vorbis', 'aac', 'mp3', 'mp4a.40.2'],
};

/**
 * Parse a Content-Type header into base type + codec list. Codec values
 * inside `codecs="..."` may be space- or comma-separated per RFC 6381.
 */
function parseContentType(value: string): { baseType: string; codecs: string[] } {
  const parts = value.split(';').map((p) => p.trim());
  const baseType = parts[0]?.toLowerCase() ?? '';
  const codecParam = parts.slice(1).find((p) => p.toLowerCase().startsWith('codecs'));
  if (!codecParam) return { baseType, codecs: [] };
  const eq = codecParam.indexOf('=');
  if (eq < 0) return { baseType, codecs: [] };
  const raw = codecParam.slice(eq + 1).trim().replace(/^"|"$/g, '');
  const codecs = raw
    .split(/[\s,]+/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  return { baseType, codecs };
}

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

@Controller('shop/upload')
@UseGuards(JwtAuthGuard)
export class ShopUploadController {
  constructor(private storage: StorageService) {}

  @Post('signed-url')
  async presign(@Body() dto: PresignedUploadDto) {
    const allowed = ALLOWED_MIME_BY_KIND[dto.kind];
    if (allowed) {
      // contentType may include codecs (e.g. `audio/webm;codecs=opus`) — match
      // on the leading mediatype, then validate codec params against the
      // per-kind allow-list (Z7).
      const { baseType, codecs } = parseContentType(dto.contentType);
      if (!allowed.includes(baseType)) {
        throw new BadRequestException(
          `contentType "${dto.contentType}" ไม่รองรับสำหรับประเภท ${dto.kind}`,
        );
      }

      const allowedCodecs = ALLOWED_CODECS_BY_KIND[dto.kind];
      if (allowedCodecs && codecs.length > 0) {
        const bad = codecs.filter((c) => !allowedCodecs.includes(c));
        if (bad.length > 0) {
          throw new BadRequestException(
            `codec "${bad.join(', ')}" ไม่รองรับสำหรับประเภท ${dto.kind}`,
          );
        }
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
