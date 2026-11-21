import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsDateString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class QueryImportedSalesDto {
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'วันที่เริ่มต้นไม่ถูกต้อง' })
  startDate?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'วันที่สิ้นสุดไม่ถูกต้อง' })
  endDate?: string;

  @IsOptional() @IsString() saleChannel?: string;
  @IsOptional() @IsString() salespersonName?: string;
  @IsOptional() @IsString() category?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'IMEI ต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'IMEI ต้องไม่เกิน 100 ตัวอักษร' })
  barcode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'เลขบิลต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'เลขบิลต้องไม่เกิน 100 ตัวอักษร' })
  orderNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}
