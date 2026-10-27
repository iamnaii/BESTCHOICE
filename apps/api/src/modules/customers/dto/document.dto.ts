import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  IsNumber,
} from 'class-validator';
import {
  CUSTOMER_ATTACHMENT_SOURCE_KINDS,
  CustomerAttachmentSourceKind,
} from '@installment/shared';
export class UploadDocumentDto {
  @IsOptional() @IsIn(CUSTOMER_ATTACHMENT_SOURCE_KINDS) sourceKind: CustomerAttachmentSourceKind;
  @IsOptional() @IsUUID() sourceId: string;
  // Unmanaged historical URL callers retain their existing metadata contract.
  @IsOptional() @IsString() @MaxLength(255) fileName: string;
  @IsOptional() @Matches(/^https:\/\/.+/) @MaxLength(2048) fileUrl: string;
  @IsOptional() @Matches(/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/) mimeType: string;
  @IsOptional() @IsNumber() @Min(1) @Max(10 * 1024 * 1024) fileSize: number;
}
export class DeleteDocumentDto {
  @IsOptional() @IsUUID() attachmentId: string;
  @IsOptional() @Matches(/^https:\/\/.+/) @MaxLength(2048) fileUrl: string;
}
