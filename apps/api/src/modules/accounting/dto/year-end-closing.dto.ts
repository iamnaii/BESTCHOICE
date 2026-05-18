import { IsInt, IsNotEmpty, IsString, Max, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * P3-SP1 — Year-End Closing DTOs.
 *
 * Year window is 2020–2030 (deliberately wide so historical backfill is
 * possible). The service further restricts the year to < current year
 * (cannot close future or in-progress fiscal year).
 */
export class YearEndClosingPreviewDto {
  @Type(() => Number)
  @IsInt({ message: 'ปีต้องเป็นตัวเลข' })
  @Min(2020, { message: 'ปีต้องไม่น้อยกว่า 2020' })
  @Max(2030, { message: 'ปีต้องไม่มากกว่า 2030' })
  year!: number;
}

export class YearEndClosingPostDto {
  @Type(() => Number)
  @IsInt({ message: 'ปีต้องเป็นตัวเลข' })
  @Min(2020, { message: 'ปีต้องไม่น้อยกว่า 2020' })
  @Max(2030, { message: 'ปีต้องไม่มากกว่า 2030' })
  year!: number;
}

export class YearEndClosingReverseDto {
  @Type(() => Number)
  @IsInt({ message: 'ปีต้องเป็นตัวเลข' })
  @Min(2020, { message: 'ปีต้องไม่น้อยกว่า 2020' })
  @Max(2030, { message: 'ปีต้องไม่มากกว่า 2030' })
  year!: number;

  @IsString({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @MinLength(10, { message: 'เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร' })
  reason!: string;
}
