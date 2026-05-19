import { IsOptional, IsString, IsEnum, IsUUID, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

const STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'READY_FOR_PICKUP',
  'CLOSED',
  'REPLACED',
  'CANCELLED',
] as const;

export class ListRepairTicketsDto {
  @IsOptional()
  @IsEnum(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  repairSupplierId?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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
