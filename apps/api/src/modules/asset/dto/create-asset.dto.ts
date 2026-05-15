import {
  IsString, IsOptional, IsNumber, IsEnum, IsDateString, IsBoolean,
  IsIn, IsNotEmpty, IsInt, IsUUID, Min, Max,
  IsArray, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AssetCategory, PaymentMethod } from '@prisma/client';

// PR 2a Task 6 (P7) — Permission settings entry. Persisted as JSONB on FixedAsset.
// UI-only metadata; no API enforcement yet.
export class PermissionConfigEntryDto {
  @IsUUID('4', { message: 'รหัสผู้ใช้ไม่ถูกต้อง' })
  userId!: string;

  @IsBoolean({ message: 'สิทธิ์ดูต้องเป็น boolean' })
  canView!: boolean;

  @IsBoolean({ message: 'สิทธิ์แก้ไขต้องเป็น boolean' })
  canEdit!: boolean;

  @IsBoolean({ message: 'สิทธิ์ลงบัญชีต้องเป็น boolean' })
  canPost!: boolean;
}

export class CreateAssetDto {
  @IsString({ message: 'กรุณาระบุชื่อสินทรัพย์' })
  @IsNotEmpty({ message: 'กรุณาระบุชื่อสินทรัพย์' })
  name: string;

  @IsOptional() @IsString()
  description?: string;

  @IsEnum(AssetCategory, { message: 'หมวดหมู่สินทรัพย์ไม่ถูกต้อง' })
  category: AssetCategory;

  @IsOptional() @IsString()
  branchId?: string;

  @IsNumber({}, { message: 'ราคาต้องเป็นตัวเลข' })
  @Min(0.01, { message: 'ราคาต้องมากกว่า 0' })
  basePrice: number;

  @IsOptional() @IsNumber() @Min(0)
  shippingCost?: number;

  @IsOptional() @IsNumber() @Min(0)
  installationCost?: number;

  @IsOptional() @IsNumber() @Min(0)
  otherCapitalized?: number;

  @IsOptional() @IsBoolean()
  hasVat?: boolean;

  @IsOptional() @IsBoolean()
  vatInclusive?: boolean;

  @IsOptional() @IsString() @IsIn(['11-4101', '11-4102'], { message: 'รหัสบัญชี VAT ไม่ถูกต้อง' })
  vatAccount?: string;

  @IsOptional() @IsBoolean()
  hasWht?: boolean;

  @IsOptional() @IsNumber() @Min(0)
  whtBaseAmount?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(0.03, { message: 'อัตรา WHT ต้องไม่เกิน 3%' })
  whtRate?: number;

  @IsOptional() @IsString() @IsIn(['21-3102', '21-3103'], { message: 'รหัสบัญชี WHT ไม่ถูกต้อง' })
  whtAccount?: string;

  @IsOptional() @IsIn(['PND3', 'PND53'], { message: 'แบบ ภ.ง.ด. ไม่ถูกต้อง' })
  whtFormType?: string;

  @IsOptional() @IsNumber() @Min(0)
  residualValue?: number;

  @IsInt({ message: 'อายุการใช้งานต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'อายุการใช้งานต้องมากกว่า 0 เดือน' })
  usefulLifeMonths: number;

  @IsDateString({}, { message: 'วันที่ซื้อไม่ถูกต้อง' })
  purchaseDate: string;

  @IsOptional() @IsDateString()
  invoiceDate?: string;

  @IsOptional() @IsDateString()
  warrantyExpire?: string;

  @IsOptional() @IsString()
  supplierName?: string;

  @IsOptional() @IsString()
  supplierTaxId?: string;

  // P6: Optional FK to Supplier master record. When provided, takes precedence
  // over supplierName/supplierTaxId text fields for downstream reporting.
  @IsOptional() @IsUUID('4', { message: 'รหัสผู้ขายไม่ถูกต้อง' })
  vendorId?: string;

  // P6: Amount actually paid to vendor (for partial-payment cases). Server
  // accepts 0..99999999.99; leaving undefined means full settlement.
  // I4: Type widened to include `null` — service handles explicit-null as
  // "clear the field" (runtime validation unchanged; @IsOptional permits both
  // undefined and null).
  @IsOptional()
  @IsNumber({}, { message: 'จำนวนเงินที่จ่ายต้องเป็นตัวเลข' })
  @Min(0, { message: 'จำนวนเงินที่จ่ายต้องไม่เป็นค่าลบ' })
  @Max(99999999.99, { message: 'จำนวนเงินที่จ่ายเกินขีดจำกัด' })
  vendorAmountPaid?: number | null;

  @IsOptional() @IsString()
  invoiceNo?: string;

  @IsOptional() @IsString()
  taxInvoiceNo?: string;

  @IsOptional() @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional() @IsString()
  paymentAccount?: string;

  @IsOptional() @IsString()
  custodian?: string;

  @IsOptional() @IsString()
  location?: string;

  @IsOptional() @IsString()
  serialNo?: string;

  @IsOptional() @IsString()
  prRef?: string;

  @IsOptional() @IsString()
  note?: string;

  @IsOptional() @IsString()
  approverId?: string;

  // PR 2a Task 6 (P7) — Permission settings (replaces single-approver UI flow).
  // Lightweight metadata; backfilled from approverId on legacy create calls.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionConfigEntryDto)
  permissionConfig?: PermissionConfigEntryDto[];
}
