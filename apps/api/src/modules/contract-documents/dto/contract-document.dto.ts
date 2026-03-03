import { IsString, IsOptional, IsNumber } from 'class-validator';

export class UploadContractDocumentDto {
  @IsString()
  documentType: string; // ContractDocumentType

  @IsString()
  fileName: string;

  @IsString()
  fileUrl: string; // base64 encoded file data

  @IsNumber()
  @IsOptional()
  fileSize?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
