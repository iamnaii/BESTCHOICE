import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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

  /**
   * Task 4 (B1): แก้จาก B0 เดิม (`@IsObject()` / `Record<string, unknown>`) เป็น string[] —
   * ต้องตรงกับ frontend B1 (คอมม่าคั่นแล้ว split เป็น array ก่อนส่ง — Task 11 EditProductModal)
   * และ buildCustomerSummary (Task 5) ที่ทำ `accessoriesIncluded.join(', ')`. `@IsObject()`
   * เดิม reject array (class-validator isObject() คัด Array.isArray ออกไปแล้ว) — เทสต์
   * เก่า/frontend ที่ส่ง array จะ 400 ทุกครั้งถ้าไม่แก้จุดนี้ เช่น ['สายชาร์จ', 'กล่อง'].
   * ยังคง 3 สถานะเดิม (undefined/null/value) ผ่าน products.service.ts (Prisma.DbNull สำหรับ
   * Json null) — ไม่กระทบ logic นั้น เปลี่ยนแค่ shape ของ "value" state
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  accessoriesIncluded?: string[];

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
