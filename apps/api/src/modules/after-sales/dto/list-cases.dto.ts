import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const TABS = ['ACTIVE', 'AWAITING_APPROVAL', 'READY', 'DONE'] as const;

function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
}

/** โคลนโครงจาก repair-tickets/dto/list-repair-tickets.dto.ts */
export class ListCasesDto {
  @IsOptional()
  @IsIn(TABS)
  tab?: (typeof TABS)[number]; // default ACTIVE — service เป็นคนใส่ค่าเริ่มต้น

  @IsOptional()
  @IsString() // รหัสสาขาไม่จำเป็นต้องเป็น UUID (seed ใช้ `branch-001`)
  branchId?: string;

  @IsOptional()
  @IsString()
  q?: string; // เลขเคส/IMEI/ชื่อ/เบอร์/เลขสัญญา

  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  stale?: boolean;

  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  summary?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
