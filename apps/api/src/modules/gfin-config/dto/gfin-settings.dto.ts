import { IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * ค่าตั้งค่า GFIN ที่ไม่ใช่ตารางราคา/เรท — เก็บใน system_config (key `gfin.*`)
 * ทุกฟิลด์ optional: ส่งเฉพาะที่ต้องการแก้ (upsert รายคีย์)
 */
export class UpdateGfinSettingsDto {
  /** % ดาวน์ขั้นต่ำที่ GFIN ตั้งให้ร้าน (dropdown เริ่มจากค่านี้ ขั้นละ 5 ถึง 80) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  minDownPct?: number;

  /** % คอมมิชชั่นตั้งต้นสำหรับมือถือ (มือ 1 และมือ 2) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  commissionPhone?: number;

  /** % คอมมิชชั่นตั้งต้นสำหรับ iPad / แท็บเล็ต */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  commissionTablet?: number;

  /** ค่าทำสัญญาที่ GFIN หักจากยอดโอนให้ร้าน (บาท) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  contractFee?: number;

  /** เวอร์ชันใบเงื่อนไข G Finn เช่น "6.5" — "" = ล้าง */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sheetVersion?: string;

  /** วันเริ่มใช้ใบเงื่อนไข YYYY-MM-DD — "" = ล้าง */
  @IsOptional()
  @IsString()
  @ValidateIf((_o, v) => v !== '')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันที่ต้องเป็นรูปแบบ ปปปป-ดด-วว' })
  sheetEffectiveDate?: string;
}
