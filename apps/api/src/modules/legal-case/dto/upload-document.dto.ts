import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

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
