import { IsString, IsOptional, IsBoolean, IsArray, MaxLength, Matches } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  type?: string = 'STORE_DIRECT';

  @IsString()
  contentHtml: string;

  @IsArray()
  @IsOptional()
  placeholders?: string[];

  @IsOptional()
  blocks?: any; // Block-based editor content (JSON)

  @IsOptional()
  settings?: any; // Template settings (JSON)

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

  @IsOptional()
  blocks?: any; // Block-based editor content (JSON)

  @IsOptional()
  settings?: any; // Template settings (JSON)

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class SignContractDto {
  @IsString()
  @MaxLength(500000, { message: 'ลายเซ็นต้องมีขนาดไม่เกิน 500KB' })
  @Matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, { message: 'ลายเซ็นต้องเป็นรูปแบบ base64 image เท่านั้น' })
  signatureImage: string; // base64 PNG

  @IsString()
  @Matches(/^(CUSTOMER|STAFF)$/, { message: 'signerType ต้องเป็น CUSTOMER หรือ STAFF' })
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
