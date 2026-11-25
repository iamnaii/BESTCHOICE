import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsEnum,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DeviceOrigin } from '@prisma/client';

export class ListProductsDto {
  @IsOptional()
  @IsEnum(DeviceOrigin)
  deviceOrigin?: DeviceOrigin;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 24;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string;

  @IsOptional()
  @IsIn(['NEW', 'USED'])
  condition?: 'NEW' | 'USED';

  @IsOptional()
  @IsString()
  conditionGrade?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsEnum(['popular', 'price_asc', 'price_desc', 'newest'])
  sort?: 'popular' | 'price_asc' | 'price_desc' | 'newest' = 'popular';

  /**
   * เงินดาวน์ที่ลูกค้าเลือก เป็น **เปอร์เซ็นต์เต็มจำนวน** (15 = 15%)
   * ต่ำกว่าขั้นต่ำของหมวดจะถูกดันขึ้นให้เอง
   *
   * ⚠️ คนละหน่วยกับ `InstallmentPreviewDto.downPct` ของ /shop/installment-preview
   * ที่รับเป็น **เศษส่วน** (0.15 = 15%) — ของเดิมเป็นแบบนั้นมาก่อนและหน้า
   * รายละเอียดสินค้าส่งค่าแบบนั้นอยู่ ห้ามแก้ข้างนั้นโดยไม่แก้ผู้เรียกด้วย
   * ที่นี่ใช้ `@IsInt()` จึงตกทันทีถ้ามีใครส่ง 0.15 มา (พังดังกว่าพังเงียบ)
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  downPct?: number;

  /** จำนวนงวดที่ลูกค้าเลือก — นอกตารางเรตจะตกไปใช้งวดยาวสุดตามเดิม */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number;

  /**
   * true = เฉพาะเครื่องที่แผนเรท 2 ไม่ต้องวางดาวน์ (ฟรีดาวน์)
   * อ่านจากค่าดิบ (`obj`) เพราะ ValidationPipe กลางเปิด enableImplicitConversion —
   * ถ้าปล่อยให้แปลงเอง สตริง "false" จะกลายเป็น true
   */
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as { freeDown?: unknown }).freeDown;
    return raw === undefined ? undefined : raw === true || raw === 'true' || raw === '1';
  })
  @IsBoolean()
  freeDown?: boolean;

  /**
   * เงินดาวน์ที่ลูกค้ามี เป็น **บาทเต็ม** (5000 = ฿5,000) — สเปค 2026-11-25 หัวข้อ 8
   * ส่งมาแล้ว `downPct` ไม่ถูกใช้ · 0 = ฟรีดาวน์ · `freeDown=true` ชนะค่านี้
   * อ่านจากค่าดิบ (`obj`) เหมือน `freeDown`: `?downAmount=` ที่เป็นสตริงว่างต้องเป็น "ไม่ได้ส่ง"
   * ไม่ใช่ 0 (enableImplicitConversion จะแปลง '' เป็น 0 ซึ่งแปลว่าฟรีดาวน์)
   */
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as { downAmount?: unknown }).downAmount;
    if (raw === undefined || raw === null || raw === '') return undefined;
    return typeof raw === 'number' ? raw : Number(raw);
  })
  @IsInt({ message: 'เงินดาวน์ต้องเป็นจำนวนเต็มบาท' })
  @Min(0, { message: 'เงินดาวน์ต้องไม่ติดลบ' })
  @Max(9_999_999, { message: 'เงินดาวน์เกินจำนวนที่รับได้' })
  downAmount?: number;
}
