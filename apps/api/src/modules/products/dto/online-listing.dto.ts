import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

export class UpdateOnlineListingDto {
  /** จัดเรียง/ลบรูปที่อยู่ใน gallery เดิมเท่านั้น — เพิ่มรูปใหม่ต้องผ่าน endpoint promote */
  @IsOptional() @IsArray() @IsUrl({ require_tld: false }, { each: true })
  @ArrayUnique({ message: 'มีรูปซ้ำในรายการ' })
  @ArrayMaxSize(8, { message: 'แกลเลอรีขึ้นเว็บได้สูงสุด 8 รูป' })
  gallery?: string[];

  @IsOptional() @IsBoolean()
  isOnlineVisible?: boolean;

  @IsOptional() @IsString() @MaxLength(2000, { message: 'คำอธิบายยาวเกิน 2000 ตัวอักษร' })
  onlineDescription?: string;
}

export const PHOTO_ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type PhotoAngle = (typeof PHOTO_ANGLES)[number];

export class PromoteListingPhotoDto {
  @IsEnum(['LEGACY', 'ANGLE'], { message: 'source ต้องเป็น LEGACY หรือ ANGLE' })
  source!: 'LEGACY' | 'ANGLE';

  /** ใช้เมื่อ source=LEGACY — index ใน Product.photos */
  @IsOptional() @IsInt() @Min(0)
  index?: number;

  /** ใช้เมื่อ source=ANGLE — ด้านจาก ProductPhoto */
  @IsOptional() @IsEnum(PHOTO_ANGLES)
  angle?: PhotoAngle;
}

/** ขอบเขตของการเปิด/ปิดแสดงบนเว็บแบบหลายเครื่อง */
export const BULK_VISIBILITY_SCOPES = ['SELECTED', 'ALL_IN_STOCK'] as const;
export type BulkVisibilityScope = (typeof BULK_VISIBILITY_SCOPES)[number];

/**
 * เปิด/ปิด "แสดงบนเว็บ" ทีเดียวหลายเครื่อง
 *
 * สวิตช์นี้ไม่ได้ตัดสินว่าเครื่องจะขึ้นเว็บจริงไหม — ตัวตัดสินคือ readiness
 * fragment (ต้องมีราคาสด/รูป/เกรด) ดังนั้นเปิดยกล็อตได้อย่างปลอดภัย เครื่องที่
 * ข้อมูลไม่ครบจะยังไม่โผล่หน้าเว็บ และ response จะบอกว่าเหลือกี่เครื่องขาดอะไร
 */
export class BulkOnlineVisibilityDto {
  @IsBoolean()
  isOnlineVisible!: boolean;

  @IsEnum(BULK_VISIBILITY_SCOPES, {
    message: 'ขอบเขตต้องเป็น SELECTED (เลือกเอง) หรือ ALL_IN_STOCK (ทุกเครื่องในสต็อก)',
  })
  scope!: BulkVisibilityScope;

  /** ใช้เมื่อ scope=SELECTED เท่านั้น */
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'มีสินค้าซ้ำในรายการ' })
  @ArrayMaxSize(500, { message: 'เลือกได้สูงสุด 500 เครื่องต่อครั้ง' })
  @IsString({ each: true })
  productIds?: string[];
}
