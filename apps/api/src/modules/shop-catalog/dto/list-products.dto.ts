import { IsOptional, IsString, IsInt, Min, Max, MaxLength, IsEnum, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class ListProductsDto {
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
}
