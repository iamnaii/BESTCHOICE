import { IsString, IsOptional, IsBoolean, IsArray } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsString()
  type: string; // STORE_DIRECT, CREDIT_CARD, STORE_WITH_INTEREST, EXCHANGE

  @IsString()
  contentHtml: string;

  @IsArray()
  @IsOptional()
  placeholders?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  contentHtml?: string;

  @IsArray()
  @IsOptional()
  placeholders?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class SignContractDto {
  @IsString()
  signatureImage: string; // base64 PNG

  @IsString()
  signerType: string; // CUSTOMER, STAFF
}

export class GenerateDocumentDto {
  @IsString()
  @IsOptional()
  templateId?: string;

  @IsString()
  @IsOptional()
  documentType?: string; // CONTRACT, RECEIPT_DOWN, RECEIPT_INSTALLMENT, PAYOFF
}
