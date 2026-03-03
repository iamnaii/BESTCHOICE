import { IsString } from 'class-validator';

export class OcrIdCardDto {
  @IsString()
  imageBase64: string; // base64 data URL of the ID card image
}

export interface OcrIdCardResult {
  nationalId: string | null;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  birthDate: string | null;
  address: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  confidence: number;
}
