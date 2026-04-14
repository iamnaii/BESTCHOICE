import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SessionQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  sessionStatus?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  unassignedOnly?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 50;
}
