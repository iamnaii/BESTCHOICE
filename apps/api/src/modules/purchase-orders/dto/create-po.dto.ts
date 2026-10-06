import { IsString, IsNumber, IsOptional, IsDateString, IsArray, ValidateNested, IsIn, IsBoolean, ArrayMinSize, Min, IsEnum, ArrayNotEmpty, IsNotEmpty, IsInt, MaxLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { DefectReason, DeviceOrigin, SupplierDocType } from '@prisma/client';
import { SUPPLIER_DOC_NUMBER_MAX } from '../services/supplier-doc.util';

export class POItemDto {
  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  storage?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  accessoryType?: string;

  @IsString()
  @IsOptional()
  accessoryBrand?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreatePODto {
  @IsString()
  supplierId: string;

  @IsDateString()
  orderDate: string;

  @IsDateString()
  @IsOptional()
  expectedDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => POItemDto)
  items: POItemDto[];

  @IsNumber()
  @IsOptional()
  @Min(0)
  discount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  discountAfterVat?: number;

  @IsIn(['UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'FULLY_PAID'])
  @IsOptional()
  paymentStatus?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsNumber()
  @IsOptional()
  paidAmount?: number;

  @IsString()
  @IsOptional()
  paymentNotes?: string;

  @IsArray()
  @IsOptional()
  attachments?: string[];

  @IsString()
  @IsOptional()
  stockCheckRef?: string; // Reference to stock alert that triggered this PO
}

export class RejectPODto {
  @IsString()
  reason: string;
}

export class OrderPODto {
  @IsDateString()
  @IsOptional()
  expectedDate?: string;
}

/**
 * Approve = order (2026-09-06): the owner confirms the expected date while approving, and —
 * because approving is the moment the owner decides to pay — may record the payment
 * (status / method / amount / notes / slips) in the same request. Every payment field is
 * optional: leaving them out approves on credit (paymentStatus stays UNPAID).
 */
export class ApprovePODto extends OrderPODto {
  @IsIn(['UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'FULLY_PAID'])
  @IsOptional()
  paymentStatus?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  @IsString()
  @IsOptional()
  paymentNotes?: string;

  @IsArray()
  @IsOptional()
  attachments?: string[];
}

export class UpdatePODto {
  @IsDateString()
  @IsOptional()
  expectedDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

/**
 * ก้อน 2 (คำตัดสินเจ้าของ 2026-10-05 ข้อ 6): ยกเลิกใบสั่งซื้อที่มีมัดจำค้าง ต้องบอกว่าได้คืนหรือไม่ได้คืน —
 * ใบที่ไม่มีมัดจำส่ง body ว่างได้. ตรวจเงื่อนไขละเอียด (จำนวน/สลิป/เหตุผล) ที่ SupplierPaymentService
 */
export class CancelPODto {
  @IsIn(['REFUNDED', 'FORFEITED'])
  @IsOptional()
  depositOutcome?: 'REFUNDED' | 'FORFEITED';

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่ได้รับเงินคืนไม่ถูกต้อง' })
  refundedAt?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  refundAmount?: number;

  @IsString()
  @IsOptional()
  slipUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

export class UpdatePaymentDto {
  @IsIn(['UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'FULLY_PAID'])
  paymentStatus: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsNumber()
  paidAmount: number;

  @IsString()
  @IsOptional()
  paymentNotes?: string;

  @IsArray()
  @IsOptional()
  attachments?: string[];
}

export class ChecklistResultDto {
  @IsString()
  item: string;

  @IsString()
  category: string;

  @IsBoolean()
  passed: boolean;

  @IsString()
  @IsOptional()
  note?: string;
}

/**
 * รูปสินค้า 6 มุมของมือสอง (base64 data URL ต่อมุม) — เขียนลง `ProductPhoto` ในรอบเดียวกับ
 * การสร้างเครื่อง (คำสั่งเจ้าของ 2026-09-07 "ตอนรับเครื่องหน้า PO ด้วย ให้มี 6 มุม")
 * ครบ 6 มุม + มีราคา ⇒ เครื่องเข้าคลังพร้อมขายทันที · ไม่ครบ ⇒ รอถ่ายรูป (คิวเดิม)
 */
export class AnglePhotosDto {
  @IsString() @IsOptional() front?: string;
  @IsString() @IsOptional() back?: string;
  @IsString() @IsOptional() left?: string;
  @IsString() @IsOptional() right?: string;
  @IsString() @IsOptional() top?: string;
  @IsString() @IsOptional() bottom?: string;
}

// New goods receiving DTOs
export class GoodsReceivingItemDto {
  @IsOptional() @IsEnum(DeviceOrigin) deviceOrigin?: DeviceOrigin | null;
  @IsOptional() @IsInt() @Min(0) shopWarrantyDays?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) warrantyTerms?: string | null;

  @IsString()
  poItemId: string;

  @IsString()
  @IsOptional()
  imeiSerial?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsArray()
  @IsOptional()
  photos?: string[];

  @IsIn(['PASS', 'REJECT'])
  status: 'PASS' | 'REJECT';

  @IsString()
  @IsOptional()
  rejectReason?: string;

  @IsEnum(DefectReason)
  @IsOptional()
  defectReason?: DefectReason;

  @IsNumber()
  @IsOptional()
  batteryHealth?: number;

  @IsBoolean()
  @IsOptional()
  warrantyExpired?: boolean;

  @IsString()
  @IsOptional()
  warrantyExpireDate?: string;

  @IsBoolean()
  @IsOptional()
  hasBox?: boolean;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChecklistResultDto)
  checklistResults?: ChecklistResultDto[];

  /** ราคาเงินสด (ราคาเต็มจำนวน) → Product.cashPrice */
  @IsNumber()
  @IsOptional()
  @Min(0)
  sellingPrice?: number;

  /** ราคาผ่อน → Product.installmentPrice (2026-09-07: the shop sells at two prices) */
  @IsNumber()
  @IsOptional()
  @Min(0)
  installmentPrice?: number;

  /** รูป 6 มุม (มือสองเท่านั้น — หมวดอื่นถูกละเลย) */
  @IsOptional()
  @ValidateNested()
  @Type(() => AnglePhotosDto)
  anglePhotos?: AnglePhotosDto;
}

export class GoodsReceivingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceivingItemDto)
  items: GoodsReceivingItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  // ข3 — เอกสารจากผู้จัดจำหน่าย (แบบหน้าจอที่เจ้าของเคาะ 2026-10-01). ประเภทบังคับที่ HTTP (IsEnum ไม่มี IsOptional) —
  // type เป็น optional เฉพาะฝั่ง TypeScript ให้ผู้เรียกภายใน (seed/เทส) ที่ไม่มีเอกสารใช้ต่อได้. เลขที่/วันที่บังคับตามประเภท
  // ตรวจใน service (`normalizeSupplierDoc`) — ไม่มีเอกสาร = ต้องเขียนเหตุผลในหมายเหตุใบรับ
  @IsEnum(SupplierDocType, { message: 'กรุณาเลือกประเภทเอกสารของผู้จัดจำหน่าย' })
  supplierDocType?: SupplierDocType;

  @IsOptional() @IsString() @MaxLength(SUPPLIER_DOC_NUMBER_MAX, { message: `เลขที่เอกสารยาวเกิน ${SUPPLIER_DOC_NUMBER_MAX} ตัวอักษร` })
  supplierDocNumber?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่ในเอกสารไม่ถูกต้อง' })
  supplierDocDate?: string;
}

export class DirectReceiveItemDto {
  @IsOptional() @IsEnum(DeviceOrigin) deviceOrigin?: DeviceOrigin | null;
  @IsOptional() @IsInt() @Min(0) shopWarrantyDays?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) warrantyTerms?: string | null;

  // Product spec (mirrors POItemDto)
  @IsString() @IsOptional() brand?: string;
  @IsString() @IsOptional() model?: string;
  @IsString() @IsOptional() color?: string;
  @IsString() @IsOptional() storage?: string;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() accessoryType?: string;
  @IsString() @IsOptional() accessoryBrand?: string;

  // One DTO item = one physical unit.
  @IsNumber() @Min(1) quantity: number;

  // ราคาซื้อต่อหน่วยก่อน VAT ก่อนส่วนลด (booked as POItem.unitPrice). goodsReceiving turns it into Product.costPrice =
  // the unit's share of the PO net amount (VAT-inclusive, after discounts — po-unit-cost.util). MANDATORY for COGS.
  @IsNumber() @Min(0.01, { message: 'กรุณาระบุราคาทุน (costPrice) มากกว่า 0' }) unitPrice: number;

  // Per-unit receiving fields (mirror GoodsReceivingItemDto)
  @IsString() @IsOptional() imeiSerial?: string;
  @IsString() @IsOptional() serialNumber?: string;
  @IsArray() @IsOptional() photos?: string[];
  @IsIn(['PASS', 'REJECT']) status: 'PASS' | 'REJECT';
  @IsString() @IsOptional() rejectReason?: string;
  @IsEnum(DefectReason) @IsOptional() defectReason?: DefectReason;
  @IsNumber() @IsOptional() batteryHealth?: number;
  @IsBoolean() @IsOptional() warrantyExpired?: boolean;
  @IsString() @IsOptional() warrantyExpireDate?: string;
  @IsBoolean() @IsOptional() hasBox?: boolean;
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => ChecklistResultDto)
  checklistResults?: ChecklistResultDto[];
  @IsNumber() @IsOptional() @Min(0) sellingPrice?: number;
  @IsNumber() @IsOptional() @Min(0) installmentPrice?: number;
  @IsOptional() @ValidateNested() @Type(() => AnglePhotosDto) anglePhotos?: AnglePhotosDto;
}

export class DirectReceiveDto {
  @IsString() supplierId: string;

  @IsDateString() orderDate: string;

  @IsString() @IsOptional() notes?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DirectReceiveItemDto)
  items: DirectReceiveItemDto[];

  // ข3 — เอกสารจากผู้จัดจำหน่าย (แบบหน้าจอที่เจ้าของเคาะ 2026-10-01). ประเภทบังคับที่ HTTP (IsEnum ไม่มี IsOptional) —
  // type เป็น optional เฉพาะฝั่ง TypeScript ให้ผู้เรียกภายใน (seed/เทส) ที่ไม่มีเอกสารใช้ต่อได้. เลขที่/วันที่บังคับตามประเภท
  // ตรวจใน service (`normalizeSupplierDoc`) — ไม่มีเอกสาร = ต้องเขียนเหตุผลในหมายเหตุใบรับ
  @IsEnum(SupplierDocType, { message: 'กรุณาเลือกประเภทเอกสารของผู้จัดจำหน่าย' })
  supplierDocType?: SupplierDocType;

  @IsOptional() @IsString() @MaxLength(SUPPLIER_DOC_NUMBER_MAX, { message: `เลขที่เอกสารยาวเกิน ${SUPPLIER_DOC_NUMBER_MAX} ตัวอักษร` })
  supplierDocNumber?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่ในเอกสารไม่ถูกต้อง' })
  supplierDocDate?: string;

  // Same money / payment fields as CreatePODto (2026-09-06): the auto-PO books VAT and
  // discounts like a normal PO, and a purchase paid on the spot is recorded as paid.
  @IsNumber() @IsOptional() @Min(0) discount?: number;
  @IsNumber() @IsOptional() @Min(0) discountAfterVat?: number;
  @IsIn(['UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'FULLY_PAID']) @IsOptional() paymentStatus?: string;
  @IsString() @IsOptional() paymentMethod?: string;
  @IsNumber() @IsOptional() @Min(0) paidAmount?: number;
  @IsString() @IsOptional() paymentNotes?: string;
  @IsArray() @IsOptional() attachments?: string[];
}

export class RejectQCDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'กรุณาเลือกสินค้าที่ไม่ผ่าน QC อย่างน้อย 1 ชิ้น' })
  @IsString({ each: true })
  productIds!: string[];

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลที่ไม่ผ่าน QC' })
  reason!: string;
}

/** ข3 — `GET /purchase-orders/receiving-doc-check` */
export class ReceivingDocCheckQueryDto {
  @IsString() supplierId: string;
  @IsOptional() @IsString() @MaxLength(SUPPLIER_DOC_NUMBER_MAX) docNumber?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่ในเอกสารไม่ถูกต้อง' }) docDate?: string;
}

/** ก้อน 5 — `POST /purchase-orders/:id/goods-receivings/:receivingId/tax-invoice` (multipart: number · date · photo?) */
export class RecordTaxInvoiceDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกเลขที่ใบกำกับภาษี' })
  @MaxLength(SUPPLIER_DOC_NUMBER_MAX, { message: `เลขที่เอกสารยาวเกิน ${SUPPLIER_DOC_NUMBER_MAX} ตัวอักษร` })
  number: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่ในใบกำกับภาษีไม่ถูกต้อง' })
  date: string;
}
