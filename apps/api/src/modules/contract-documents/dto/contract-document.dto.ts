import { IsString, IsOptional, IsNumber, MaxLength, Matches } from 'class-validator';

export class UploadContractDocumentDto {
  @IsString()
  @Matches(/^(SIGNED_CONTRACT|ID_CARD_COPY|KYC|FACEBOOK_PROFILE|FACEBOOK_POST|LINE_PROFILE|DEVICE_RECEIPT_PHOTO|BANK_STATEMENT|OTHER)$/, { message: 'ประเภทเอกสารไม่ถูกต้อง' })
  documentType: string; // ContractDocumentType

  @IsString()
  @MaxLength(255, { message: 'ชื่อไฟล์ต้องไม่เกิน 255 ตัวอักษร' })
  @Matches(/^[^/\\:*?"<>|]+$/, { message: 'ชื่อไฟล์มีอักขระที่ไม่อนุญาต' })
  fileName: string;

  @IsString()
  @MaxLength(15_000_000, { message: 'ไฟล์ต้องมีขนาดไม่เกิน 10MB' })
  fileUrl: string; // base64 encoded file data

  @IsNumber()
  @IsOptional()
  fileSize?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร' })
  notes?: string;
}
