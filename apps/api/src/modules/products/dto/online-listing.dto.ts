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
