import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class InstallmentPreviewDto {
  @IsString()
  productId!: string;

  @IsEnum(['BC', 'GFIN'])
  provider!: 'BC' | 'GFIN';

  /** GFIN ไม่ส่ง = งวดตั้งต้นของเครื่อง (งวดเรท 2 ของราคากลาง ไม่มีแล้วเพดานกติกา OVER) · BC ต้องส่ง */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  downPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customDownAmount?: number;
}
