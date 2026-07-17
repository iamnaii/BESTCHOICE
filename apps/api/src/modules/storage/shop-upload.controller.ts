import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { randomUUID } from 'crypto';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

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
  [UploadKind.MDM_WALLPAPER]: ['image/jpeg', 'image/png', 'image/webp'],
  [UploadKind.VOICE_MEMO]: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'],
};

/**
 * Kinds that anonymous shoppers on the web-shop are allowed to presign.
 * Trade-in / buyback / review submissions and checkout slips all happen
 * BEFORE the customer has any account — requiring a staff JWT here broke
 * every photo upload on the storefront. Staff-only kinds (letters, MDM,
 * voice memos) stay behind the JWT route below.
 */
// BUYBACK_PHOTO ถูกถอดออก (2026-07): buyback instant-quote ไม่รับรูปแล้ว —
// คง enum value ไว้ให้ record เก่า แต่ปิดช่อง presign นิรนามที่ไร้ผู้เรียก
const PUBLIC_UPLOAD_KINDS: readonly UploadKind[] = [
  UploadKind.TRADE_IN_PHOTO,
  UploadKind.BANK_SLIP,
  UploadKind.REVIEW_PHOTO,
];

@Controller('shop/upload')
export class ShopUploadController {
  constructor(private storage: StorageService) {}

  /** Staff route (apps/web: slips, letters, MDM, voice memos) — unchanged. */
  @Post('signed-url')
  @UseGuards(JwtAuthGuard)
  async presign(@Body() dto: PresignedUploadDto) {
    return this.buildPresign(dto);
  }

  /**
   * Anonymous storefront route (apps/web-shop) — bot-defense + throttle in
   * place of JWT, mirroring the rest of the public shop-* family. Only the
   * customer-facing kinds are allowed through.
   */
  @Post('public-signed-url')
  @UseGuards(ShopBotDefenseGuard)
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  async presignPublic(@Body() dto: PresignedUploadDto) {
    if (!PUBLIC_UPLOAD_KINDS.includes(dto.kind)) {
      throw new BadRequestException(`ประเภทไฟล์ ${dto.kind} ไม่รองรับสำหรับการอัปโหลดนี้`);
    }
    return this.buildPresign(dto);
  }

  private async buildPresign(dto: PresignedUploadDto) {
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
