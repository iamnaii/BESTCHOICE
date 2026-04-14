import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';

export class CloseMonthDto {
  @IsInt({ message: 'ปีต้องเป็นจำนวนเต็ม' })
  @Min(2020)
  year: number;

  @IsInt({ message: 'เดือนต้องเป็น 1-12' })
  @Min(1)
  @Max(12)
  month: number;

  @IsString()
  companyId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
