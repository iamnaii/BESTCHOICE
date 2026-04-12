import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class AuditFilterDto {
  @IsOptional()
  @IsString({ message: 'กรุณาระบุชื่อ check ที่ถูกต้อง' })
  checkName?: string;

  @IsOptional()
  @IsString({ message: 'กรุณาระบุสถานะที่ถูกต้อง' })
  status?: string;
}

export class TraceFilterDto {
  @IsOptional()
  @IsString({ message: 'กรุณาระบุสถานะสัญญา' })
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'จำนวนสัญญาต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'ต้องตรวจอย่างน้อย 1 สัญญา' })
  @Max(500, { message: 'ตรวจได้สูงสุด 500 สัญญาต่อครั้ง' })
  limit?: number;
}

export class AuditHistoryDto {
  @IsOptional()
  @IsString()
  checkName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
