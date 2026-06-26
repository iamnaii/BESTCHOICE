import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class SessionQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  status?: string;

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
  @IsBoolean()
  // NOT @Type(() => Boolean): Boolean('false') === true. Coerce explicitly so
  // ?unreadOnly=false means false.
  @Transform(({ value }) => value === true || value === 'true')
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  channels?: string; // comma-separated list, e.g. "LINE_FINANCE,FACEBOOK"

  @IsOptional()
  @IsString()
  aiStatus?: string; // 'ai' | 'human' | 'pending'

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
