import { IsString } from 'class-validator';

export class OcrIdCardDto {
  @IsString()
  imageBase64: string; // base64 data URL of the ID card image
}

export interface OcrAddressStructured {
  houseNo: string;
  moo: string;
  village: string;
  soi: string;
  road: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

export interface OcrIdCardResult {
  nationalId: string | null;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  birthDate: string | null;
  address: string | null;
  addressStructured: OcrAddressStructured | null;
  issueDate: string | null;
  expiryDate: string | null;
  confidence: number;
}
