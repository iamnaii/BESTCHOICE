import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  Min,
  MaxLength,
} from 'class-validator';

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  name?: string;

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
  imeiSerial?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsNumber()
  @IsOptional()
  costPrice?: number;

  /**
   * B0: ราคาเงินสดต่อเครื่อง — 3 สถานะ: ไม่ส่ง = ไม่แตะ / เลข ≥ 1 = ตั้งราคา / null = เคลียร์ราคา
   * `@IsOptional()` ปล่อย null ผ่านโดยไม่ validate — ตั้งใจ (ดู products.service.ts create/update)
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
  branchId?: string;

  @IsString()
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
}
