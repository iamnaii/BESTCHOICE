import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class OcrIdCardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000_000) // ~3.75MB base64 (frontend compresses to ~300KB)
  imageBase64: string; // base64 data URL of the ID card image
}

export class OcrPaymentSlipDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000_000)
  imageBase64: string; // base64 data URL of the payment slip image
}

export class OcrBookBankDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000_000)
  imageBase64: string; // base64 data URL of the bank passbook image
}

export class OcrDrivingLicenseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000_000)
  imageBase64: string; // base64 data URL of the driving license image
}

export class OcrGenerateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000_000) // ~7.5MB base64 for larger document images
  imageBase64: string; // base64 data URL of the document image
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
  nationalIdValid: boolean;
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

export interface OcrPaymentSlipResult {
  amount: number | null;
  senderName: string | null;
  senderBank: string | null;
  senderAccountNo: string | null;
  receiverName: string | null;
  receiverBank: string | null;
  receiverAccountNo: string | null;
  transactionRef: string | null;
  transactionDate: string | null; // YYYY-MM-DD
  transactionTime: string | null; // HH:mm
  slipType: 'BANK_TRANSFER' | 'QR_PAYMENT' | 'PROMPTPAY' | 'OTHER' | null;
  confidence: number;
}

export interface OcrBookBankResult {
  accountName: string | null;
  accountNo: string | null;
  bankName: string | null;
  branchName: string | null;
  accountType: string | null; // ออมทรัพย์, กระแสรายวัน, ฝากประจำ
  balance: number | null;
  lastTransactionDate: string | null;
  confidence: number;
}

export interface OcrDrivingLicenseResult {
  licenseNo: string | null;
  nationalId: string | null;
  nationalIdValid: boolean;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  birthDate: string | null;
  address: string | null;
  addressStructured: OcrAddressStructured | null;
  licenseType: string | null; // ส่วนบุคคล, สาธารณะ, ชั่วคราว
  issueDate: string | null;
  expiryDate: string | null;
  bloodType: string | null;
  confidence: number;
}
