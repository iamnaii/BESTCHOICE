import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueueQueryDto {
  @IsEnum(['today', 'followup', 'promise'], { message: 'tab ต้องเป็น today, followup, หรือ promise' })
  tab!: 'today' | 'followup' | 'promise';

  @IsOptional()
  @IsString()
  branchId?: string;

  /** C1: server-side search by customer name / contractNumber / phone */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
