import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Max upload size for a legal-case document — 10MB. Mirrored on FE. */
export const LEGAL_DOC_MAX_BYTES = 10 * 1024 * 1024;

export const ALLOWED_LEGAL_DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AllowedLegalDocMime = (typeof ALLOWED_LEGAL_DOC_MIME)[number];

export const LEGAL_DOC_KINDS = [
  'complaint',
  'summons',
  'judgment',
  'settlement',
  'other',
] as const;
export type LegalDocKind = (typeof LEGAL_DOC_KINDS)[number];

/**
 * Request a presigned upload URL for a legal-case document.
 * The client uploads directly to S3/GCS via the returned URL, then
 * registers the resulting object key via `RegisterLegalDocumentDto`.
 */
export class PresignLegalDocumentDto {
  @IsString()
  @IsIn(ALLOWED_LEGAL_DOC_MIME, {
    message: 'ไฟล์ต้องเป็น PDF / JPEG / PNG เท่านั้น',
  })
  contentType!: AllowedLegalDocMime;

  @IsString()
  @IsIn(LEGAL_DOC_KINDS, { message: 'ประเภทเอกสารไม่ถูกต้อง' })
  kind!: LegalDocKind;

  @IsString()
  @MinLength(1, { message: 'กรุณาระบุชื่อไฟล์' })
  @MaxLength(255, { message: 'ชื่อไฟล์ยาวเกินไป' })
  filename!: string;

  /**
   * Declared upload size in bytes. Enforced both as DTO bound and (where the
   * storage backend supports it) as a `content-length-range` condition on the
   * presigned URL itself.
   */
  @IsInt({ message: 'ขนาดไฟล์ไม่ถูกต้อง' })
  @Min(1, { message: 'ขนาดไฟล์ไม่ถูกต้อง' })
  @Max(LEGAL_DOC_MAX_BYTES, { message: 'ไฟล์ใหญ่เกิน 10MB' })
  contentLength!: number;
}

/**
 * Register a successful upload — persists a `LegalCaseDocument` row pointing
 * at the S3 key returned from the presign step.
 */
export class RegisterLegalDocumentDto {
  @IsString()
  @IsIn(LEGAL_DOC_KINDS, { message: 'ประเภทเอกสารไม่ถูกต้อง' })
  kind!: LegalDocKind;

  @IsString()
  @MinLength(1, { message: 'กรุณาระบุชื่อไฟล์' })
  @MaxLength(255, { message: 'ชื่อไฟล์ยาวเกินไป' })
  filename!: string;

  @IsString()
  @MinLength(1, { message: 'กรุณาระบุ s3 key' })
  s3Key!: string;
}
