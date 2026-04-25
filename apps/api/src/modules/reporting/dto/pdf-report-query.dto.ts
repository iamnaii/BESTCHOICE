import { IsDateString, IsOptional } from 'class-validator';

/**
 * Query DTO for on-demand PDF report generation.
 * Both `from` and `to` are optional; service defaults to last 7 days.
 */
export class PdfReportQueryDto {
  @IsOptional()
  @IsDateString({}, { message: 'รูปแบบวันที่ไม่ถูกต้อง (from ต้องเป็น ISO date)' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'รูปแบบวันที่ไม่ถูกต้อง (to ต้องเป็น ISO date)' })
  to?: string;
}
