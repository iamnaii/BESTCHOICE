import { IsString, IsOptional, IsBoolean, IsArray, MaxLength, Matches, ArrayMaxSize, IsNotEmpty } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  type?: string = 'STORE_DIRECT';

  @IsString()
  @MaxLength(1048576)
  @IsNotEmpty()
  contentHtml: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  placeholders?: string[];

  @IsOptional()
  blocks?: unknown; // Block-based editor content (JSON)

  @IsOptional()
  settings?: unknown; // Template settings (JSON)

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  @MaxLength(256)
  @IsNotEmpty()
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1048576)
  @IsNotEmpty()
  contentHtml?: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  placeholders?: string[];

  @IsOptional()
  blocks?: unknown; // Block-based editor content (JSON)

  @IsOptional()
  settings?: unknown; // Template settings (JSON)

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
  @IsOptional()
  signatureSvg?: string; // SVG path data

  @IsString()
  @Matches(/^(CUSTOMER|COMPANY|STAFF|WITNESS_1|WITNESS_2|GUARDIAN)$/, {
    message: 'signerType ต้องเป็น CUSTOMER, COMPANY, STAFF, WITNESS_1, WITNESS_2 หรือ GUARDIAN',
  })
  signerType: string;

  @IsString()
  @IsOptional()
  signerName?: string; // ชื่อผู้เซ็น

  @IsString()
  @IsOptional()
  screenSize?: string; // ขนาดหน้าจอ

  @IsOptional()
  gpsLatitude?: number;

  @IsOptional()
  gpsLongitude?: number;
}

export class GenerateDocumentDto {
  @IsString()
  @IsOptional()
  templateId?: string;

  @IsString()
  @IsOptional()
  documentType?: string; // CONTRACT, RECEIPT_DOWN, RECEIPT_INSTALLMENT, PAYOFF
}
