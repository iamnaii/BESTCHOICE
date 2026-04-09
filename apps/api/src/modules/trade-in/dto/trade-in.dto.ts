import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsBoolean,
  Length,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateTradeInDto {
  // ─── Customer / Branch ──────────────────────────────
  @IsString()
  @IsOptional()
  customerId?: string; // optional — walk-in seller may not be a customer

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsOptional()
  productId?: string;

  // ─── Device ─────────────────────────────────────────
  @IsString({ message: 'กรุณาระบุยี่ห้อเครื่อง' })
  deviceBrand: string;

  @IsString({ message: 'กรุณาระบุรุ่นเครื่อง' })
  deviceModel: string;

  @IsString()
  @IsOptional()
  deviceStorage?: string;

  @IsString()
  @IsOptional()
  deviceColor?: string;

  @IsString()
  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D'], { message: 'สภาพเครื่องต้องเป็น A, B, C หรือ D' })
  deviceCondition?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{15}$/, { message: 'IMEI ต้องเป็นตัวเลข 15 หลัก' })
  imei?: string;

  @IsNumber({}, { message: 'ราคาประเมินต้องเป็นตัวเลข' })
  @IsOptional()
  estimatedValue?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  // ─── Seller info (walk-in) ──────────────────────────
  @IsString()
  @IsOptional()
  sellerName?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{9,10}$/, { message: 'เบอร์โทรไม่ถูกต้อง' })
  sellerPhone?: string;

  @IsString()
  @IsOptional()
  @Length(13, 13, { message: 'เลขบัตรประชาชนต้อง 13 หลัก' })
  sellerIdCardNumber?: string;

  @IsString()
  @IsOptional()
  sellerAddress?: string;

  // ─── ID card evidence ───────────────────────────────
  @IsString()
  @IsOptional()
  idCardPhotoBase64?: string; // data URL or raw base64

  @IsString()
  @IsOptional()
  @IsIn(['card_reader', 'upload'])
  idCardSource?: string;

  // ─── Anti-theft consent ─────────────────────────────
  @IsBoolean()
  @IsOptional()
  sellerConsentSigned?: boolean;

  @IsBoolean()
  @IsOptional()
  policeReportAcknowledged?: boolean;
}

export class UpdateTradeInDto {
  @IsString() @IsOptional() sellerName?: string;
  @IsString() @IsOptional() sellerPhone?: string;
  @IsString() @IsOptional() @Length(13, 13) sellerIdCardNumber?: string;
  @IsString() @IsOptional() sellerAddress?: string;
  @IsString() @IsOptional() deviceColor?: string;
  @IsString() @IsOptional() notes?: string;
}

export class AppraiseTradeInDto {
  @IsNumber({}, { message: 'กรุณาระบุราคาที่เสนอ' })
  offeredPrice: number;

  @IsString({ message: 'กรุณาระบุสภาพเครื่อง' })
  deviceCondition: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AcceptTradeInDto {
  @IsBoolean({ message: 'ต้องยืนยันว่าตรวจบัตรประชาชนแล้ว' })
  idCardVerified: boolean;

  @IsBoolean({ message: 'ผู้ขายต้องเซ็นยืนยันความเป็นเจ้าของ' })
  sellerConsentSigned: boolean;

  @IsBoolean()
  @IsOptional()
  policeReportAcknowledged?: boolean;

  @IsString({ message: 'กรุณาเลือกวิธีชำระเงิน' })
  @IsIn(['CASH', 'TRANSFER'], { message: "วิธีชำระต้องเป็น 'CASH' หรือ 'TRANSFER'" })
  paymentMethod: 'CASH' | 'TRANSFER';

  @IsString()
  @IsOptional()
  transferBankName?: string;

  @IsString()
  @IsOptional()
  transferAccountNumber?: string;

  @IsString()
  @IsOptional()
  transferAccountName?: string;

  @IsString()
  @IsOptional()
  sellerSignatureBase64?: string;
}

/**
 * Quick Buy DTO — รวม create + appraise + accept + voucher allocate ใน step เดียว
 * สำหรับเคส POS counter ที่พนักงานตัดสินใจรับซื้อทันทีโดยไม่ต้องส่งผู้จัดการอนุมัติ
 */
export class QuickBuyTradeInDto {
  // Seller (walk-in)
  @IsString({ message: 'กรุณาระบุชื่อผู้ขาย' })
  sellerName: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{9,10}$/, { message: 'เบอร์โทรไม่ถูกต้อง' })
  sellerPhone?: string;

  @IsString()
  @IsOptional()
  @Length(13, 13, { message: 'เลขบัตรประชาชนต้อง 13 หลัก' })
  sellerIdCardNumber?: string;

  @IsString()
  @IsOptional()
  sellerAddress?: string;

  @IsString()
  @IsOptional()
  idCardPhotoBase64?: string;

  @IsString()
  @IsOptional()
  @IsIn(['card_reader', 'upload'])
  idCardSource?: 'card_reader' | 'upload';

  // Branch
  @IsString()
  @IsOptional()
  branchId?: string;

  // Device
  @IsString({ message: 'กรุณาระบุยี่ห้อ' })
  deviceBrand: string;

  @IsString({ message: 'กรุณาระบุรุ่น' })
  deviceModel: string;

  @IsString()
  @IsOptional()
  deviceStorage?: string;

  @IsString()
  @IsOptional()
  deviceColor?: string;

  @IsString()
  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D'], { message: 'สภาพต้องเป็น A/B/C/D' })
  deviceCondition?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{15}$/, { message: 'IMEI ต้องเป็นตัวเลข 15 หลัก' })
  imei?: string;

  // Price (ราคาที่ตกลงเลย — ไม่แยก estimate/offer)
  @IsNumber({}, { message: 'กรุณาระบุราคารับซื้อ' })
  agreedPrice: number;

  // Anti-theft consent
  @IsBoolean({ message: 'ต้องยืนยันว่าตรวจบัตรประชาชนแล้ว' })
  idCardVerified: boolean;

  @IsBoolean({ message: 'ผู้ขายต้องเซ็นยืนยันความเป็นเจ้าของ' })
  sellerConsentSigned: boolean;

  @IsString()
  @IsOptional()
  sellerSignatureBase64?: string;

  // Payment
  @IsString()
  @IsIn(['CASH', 'TRANSFER'], { message: "วิธีชำระต้องเป็น 'CASH' หรือ 'TRANSFER'" })
  paymentMethod: 'CASH' | 'TRANSFER';

  @IsString()
  @IsOptional()
  transferBankName?: string;

  @IsString()
  @IsOptional()
  transferAccountNumber?: string;

  @IsString()
  @IsOptional()
  transferAccountName?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// ─── Valuation lookup ─────────────────────────────────────────────────────────

export class ValuationQueryDto {
  @IsString({ message: 'กรุณาระบุยี่ห้อ' })
  brand: string;

  @IsString({ message: 'กรุณาระบุรุ่น' })
  model: string;

  @IsString({ message: 'กรุณาระบุความจุ' })
  storage: string;

  @IsString()
  @IsIn(['A', 'B', 'C', 'D'], { message: 'สภาพต้องเป็น A, B, C หรือ D' })
  condition: string;
}

export class UpsertValuationDto {
  @IsString({ message: 'กรุณาระบุยี่ห้อ' })
  brand: string;

  @IsString({ message: 'กรุณาระบุรุ่น' })
  model: string;

  @IsString({ message: 'กรุณาระบุความจุ' })
  storage: string;

  @IsString()
  @IsIn(['A', 'B', 'C', 'D'], { message: 'สภาพต้องเป็น A, B, C หรือ D' })
  condition: string;

  @Transform(({ value }) => Number(value))
  @IsNumber({}, { message: 'ราคาต้องเป็นตัวเลข' })
  basePrice: number;

  @IsString()
  @IsOptional()
  note?: string;
}

