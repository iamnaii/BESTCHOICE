import { DeviceOrigin } from '@prisma/client';
import {
  IsEnum,
  IsString,
  IsOptional,
  IsNumber,
  Min,
  IsIn,
  IsBoolean,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { QuoteAnswerDto } from '../../shop-buyback/dto/quote.dto';
import { TRADE_IN_DECLARATION_VERSION, TRADE_IN_DECLARATION_VERSION_ERROR } from '@installment/shared';

class DeviceEvidenceDto {
  @IsString() @IsOptional() @MaxLength(300) imeiMissingReason?: string | null;
  @IsString() @IsOptional() @MaxLength(300) serialNumberMissingReason?: string | null;
}

export class CreateTradeInDto extends DeviceEvidenceDto {
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

  @IsString()
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(100, { message: 'Serial Number ต้องไม่เกิน 100 ตัวอักษร' })
  serialNumber?: string;

  @IsNumber({}, { message: 'ราคาประเมินต้องเป็นตัวเลข' })
  @IsOptional()
  estimatedValue?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  // ─── Seller info (walk-in) ──────────────────────────
  /** Party-master contactId for the seller. Stored for traceability alongside
   *  sellerName/sellerPhone (which are kept for display purposes). */
  @IsUUID('4')
  @IsOptional()
  sellerContactId?: string;

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

  /// Reason required when the appraiser exceeds the ±15% ceiling vs the
  /// TradeInValuation base table. Service enforces this — DTO keeps it optional
  /// for the happy path where no exception is needed.
  @IsString()
  @IsOptional()
  deviationReason?: string;

  /// T5-C17: OWNER-only override that allows re-appraising an already-locked
  /// trade-in with a DIFFERENT offeredPrice. Requires `forceReason`. Both are
  /// written to AuditLog for accountability — staff can no longer silently
  /// drift prices down until the seller agrees.
  @IsBoolean()
  @IsOptional()
  force?: boolean;

  @IsString()
  @IsOptional()
  forceReason?: string;
}

export class AcceptTradeInDto extends DeviceEvidenceDto {
  @IsString() @IsOptional() @MaxLength(200) sellerName?: string;
  @IsString() @IsOptional() @Matches(/^\d{9,10}$/) sellerPhone?: string;
  @IsString() @IsOptional() @Length(13, 13) sellerIdCardNumber?: string;
  @IsString() @IsOptional() @MaxLength(2000) sellerAddress?: string;
  @IsString()
  @IsOptional()
  @Matches(/^\d{15}$/, { message: 'IMEI ต้องเป็นตัวเลข 15 หลัก' })
  imei?: string | null;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(100, { message: 'Serial Number ต้องไม่เกิน 100 ตัวอักษร' })
  serialNumber?: string | null;

  @IsIn([TRADE_IN_DECLARATION_VERSION], { message: TRADE_IN_DECLARATION_VERSION_ERROR })
  declarationVersion: string;
  @IsOptional()
  @IsEnum(DeviceOrigin)
  deviceOrigin?: DeviceOrigin | null;

  @IsBoolean({ message: 'ต้องยืนยันว่าตรวจบัตรประชาชนแล้ว' })
  idCardVerified: boolean;

  @IsBoolean({ message: 'ผู้ขายต้องเซ็นยืนยันความเป็นเจ้าของ' })
  sellerConsentSigned: boolean;

  @IsBoolean()
  @IsOptional()
  policeReportAcknowledged?: boolean;

  @IsString({ message: 'กรุณาเลือกวิธีชำระเงิน' })
  @IsIn(['CASH', 'TRANSFER', 'TRADE_IN_CREDIT'], { message: 'กรุณาเลือกวิธีรับเงินหรือเครดิตเทิร์นเครื่อง' })
  paymentMethod: 'CASH' | 'TRANSFER' | 'TRADE_IN_CREDIT';

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

  /**
   * สาขาที่รับเครื่อง — ใช้เฉพาะ record ออนไลน์ที่ยังไม่ผูกสาขา (branchId null)
   * record ที่ผูกสาขาแล้วส่งค่าต่างมา = 400 (กัน re-home ข้ามสาขาเงียบๆ)
   */
  @IsString()
  @IsOptional()
  branchId?: string;
}

/**
 * Quick Buy DTO — รวม create + appraise + accept + voucher allocate ใน step เดียว
 * สำหรับเคส POS counter ที่พนักงานตัดสินใจรับซื้อทันทีโดยไม่ต้องส่งผู้จัดการอนุมัติ
 */
export class QuickBuyTradeInDto extends DeviceEvidenceDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteAnswerDto)
  answers?: QuoteAnswerDto[];

  @IsOptional()
  @IsBoolean({ message: 'กรุณายืนยันเงื่อนไขรับซื้อ' })
  deviceEligibilityConfirmed?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: 'ข้อมูลตัวอย่างราคาไม่ถูกต้อง กรุณาประเมินใหม่' })
  previewToken?: string;

  @IsUUID('4', { message: 'กรุณารีเฟรชหน้าเพื่อเริ่มรายการรับซื้อ' })
  requestId: string;
  @IsOptional()
  @IsEnum(DeviceOrigin)
  deviceOrigin?: DeviceOrigin | null;

  // Seller (walk-in) — party-master contact resolved by the picker upstream
  @IsUUID('4')
  @IsOptional()
  sellerContactId?: string;

  // sellerName is optional when the operator has selected a known Contact via the
  // party-master picker (sellerContactId present). Keep for display / free-text fallback.
  @IsOptional()
  @IsString({ message: 'กรุณาระบุชื่อผู้ขาย' })
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

  @IsString()
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(100, { message: 'Serial Number ต้องไม่เกิน 100 ตัวอักษร' })
  serialNumber?: string;

  // Price (ราคาที่ตกลงเลย — ไม่แยก estimate/offer)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ราคารับซื้อต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' })
  @Min(0.01, { message: 'ราคารับซื้อต้องอย่างน้อย 0.01 บาท' })
  agreedPrice: number;

  // Anti-theft consent
  @IsIn([TRADE_IN_DECLARATION_VERSION], { message: TRADE_IN_DECLARATION_VERSION_ERROR })
  declarationVersion: string;

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
