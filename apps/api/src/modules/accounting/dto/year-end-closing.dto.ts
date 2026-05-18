import { IsInt, IsNotEmpty, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * P3-SP1 — Year-End Closing DTOs.
 *
 * Year lower bound is 2020 (historical backfill window). No upper bound is
 * applied here — the service-side `validateYear` enforces `year < currentYear`
 * which is the meaningful guard (cannot close future or in-progress fiscal
 * year). Hardcoding an upper bound here would silently break the system in
 * that year (e.g. `Max(2030)` would 400 every request starting Jan 2031).
 */
export class YearEndClosingPreviewDto {
  @Type(() => Number)
  @IsInt({ message: 'ปีต้องเป็นตัวเลข' })
  @Min(2020, { message: 'ปีต้องไม่น้อยกว่า 2020' })
  year!: number;
}

export class YearEndClosingPostDto {
  @Type(() => Number)
  @IsInt({ message: 'ปีต้องเป็นตัวเลข' })
  @Min(2020, { message: 'ปีต้องไม่น้อยกว่า 2020' })
  year!: number;
}

export class YearEndClosingReverseDto {
  @Type(() => Number)
  @IsInt({ message: 'ปีต้องเป็นตัวเลข' })
  @Min(2020, { message: 'ปีต้องไม่น้อยกว่า 2020' })
  year!: number;

  @IsString({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @MinLength(10, { message: 'เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร' })
  reason!: string;
}
