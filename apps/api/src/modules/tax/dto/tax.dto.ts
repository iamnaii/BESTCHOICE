import { IsNotEmpty, IsString, IsInt, IsIn, Min, Max, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class GenerateTaxReportDto {
  @IsNotEmpty({ message: 'กรุณาระบุบริษัท' })
  @IsString()
  companyId: string;

  @IsIn(['PP30', 'PND3', 'PND53'], { message: 'ประเภทรายงานไม่ถูกต้อง' })
  reportType: string;

  @IsInt({ message: 'กรุณาระบุปี' })
  @Type(() => Number)
  reportYear: number;

  @IsInt({ message: 'กรุณาระบุเดือน (1-12)' })
  @Min(1, { message: 'กรุณาระบุเดือน (1-12)' })
  @Max(12, { message: 'กรุณาระบุเดือน (1-12)' })
  @Type(() => Number)
  reportMonth: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
