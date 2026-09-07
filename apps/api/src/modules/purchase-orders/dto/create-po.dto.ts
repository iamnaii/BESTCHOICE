import { IsString, IsNumber, IsOptional, IsDateString, IsArray, ValidateNested, IsIn, IsBoolean, ArrayMinSize, Min, IsEnum, ArrayNotEmpty, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { DefectReason } from '@prisma/client';

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

// New goods receiving DTOs
export class GoodsReceivingItemDto {
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
}

export class DirectReceiveItemDto {
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

  // costPrice (booked as POItem.unitPrice; copied into Product.costPrice by goodsReceiving). MANDATORY for COGS.
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
}

export class DirectReceiveDto {
  @IsString() supplierId: string;

  @IsDateString() orderDate: string;

  @IsString() @IsOptional() notes?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DirectReceiveItemDto)
  items: DirectReceiveItemDto[];

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
