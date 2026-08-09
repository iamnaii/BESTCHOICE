import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsInt,
  IsObject,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePriceDto {
  @IsString()
  label: string;

  @IsNumber()
  amount: number;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  brand: string;

  @IsString()
  model: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  storage?: string;

  @IsString()
  @IsOptional()
  imeiSerial?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsIn(['PHONE_NEW', 'PHONE_USED', 'TABLET', 'ACCESSORY'], { message: 'หมวดหมู่สินค้าต้องเป็น PHONE_NEW, PHONE_USED, TABLET หรือ ACCESSORY' })
  category: string;

  @IsNumber()
  costPrice: number;

  /**
   * B0: ราคาเงินสดต่อเครื่อง — แหล่งราคาจริง (เขียน prices[] ให้อัตโนมัติ)
   * 3 สถานะ: ไม่ส่ง = ไม่แตะ / ส่งเลข ≥ 1 = ตั้งราคา / ส่ง null = เคลียร์ราคา
   * ⚠️ `@Min(1)` ไม่ใช่ `@Min(0)` — ราคา 0 ที่หลุดลงคอลัมน์จะชนะแถว prices[] ที่มีราคาจริง
   * ในเครื่องคิดเงินสัญญา (Task 1) = ทำสัญญา 0 บาท. "ไม่มีราคา" ต้องแทนด้วย null เท่านั้น
   * (`@IsOptional()` ปล่อย null ผ่านโดยไม่ validate — ตั้งใจ)
   */
  @IsNumber({}, { message: 'ราคาเงินสดต้องเป็นตัวเลข' })
  @Min(1, { message: 'ราคาเงินสดต้องมากกว่า 0 (ถ้าต้องการล้างราคาให้ส่ง null)' })
  @IsOptional()
  cashPrice?: number | null;

  /** B0: ราคาตั้งต้นสำหรับคำนวณผ่อน (ยอดเต็ม ไม่ใช่ค่างวด) — null = ล้างราคา */
  @IsNumber({}, { message: 'ราคาผ่อนต้องเป็นตัวเลข' })
  @Min(1, { message: 'ราคาผ่อนต้องมากกว่า 0 (ถ้าต้องการล้างราคาให้ส่ง null)' })
  @IsOptional()
  installmentPrice?: number | null;

  @IsIn(['A', 'B', 'C', 'D'], { message: 'เกรดเครื่องต้องเป็น A, B, C หรือ D' })
  @IsOptional()
  conditionGrade?: string;

  @IsInt({ message: 'จำนวนวันประกันร้านต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'จำนวนวันประกันร้านต้องไม่ติดลบ' })
  @IsOptional()
  shopWarrantyDays?: number;

  @IsObject({ message: 'อุปกรณ์ที่แถมต้องเป็นอ็อบเจกต์' })
  @IsOptional()
  accessoriesIncluded?: Record<string, unknown>;

  @IsString()
  @MaxLength(500, { message: 'ตำหนิ/สภาพภายนอกยาวเกิน 500 ตัวอักษร' })
  @IsOptional()
  cosmeticNotes?: string;

  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  poId?: string;

  @IsString()
  branchId: string;

  @IsIn(['PO_RECEIVED', 'QC_PENDING', 'PHOTO_PENDING', 'INSPECTION', 'IN_STOCK', 'RESERVED', 'SOLD_INSTALLMENT', 'SOLD_CASH', 'REPOSSESSED', 'REFURBISHED', 'SOLD_RESELL', 'DAMAGED', 'LOST', 'WRITTEN_OFF'], { message: 'สถานะสินค้าไม่ถูกต้อง' })
  @IsOptional()
  status?: string;

  @IsArray()
  @IsOptional()
  photos?: string[];

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

  @IsString()
  @IsOptional()
  accessoryType?: string;

  @IsString()
  @IsOptional()
  accessoryBrand?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceDto)
  @IsOptional()
  prices?: CreatePriceDto[];
}
